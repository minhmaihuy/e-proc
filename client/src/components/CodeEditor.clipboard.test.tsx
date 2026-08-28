import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodeEditor from './CodeEditor';

const editorHarness = vi.hoisted(() => {
  const commands = new Map<number, () => void>();
  let latestOptions: Record<string, unknown> | undefined;

  const editor = {
    addAction: vi.fn(),
    addCommand: vi.fn((keybinding: number, handler: () => void) => {
      commands.set(keybinding, handler);
    }),
    focus: vi.fn(),
    onMouseDown: vi.fn(() => ({ dispose: vi.fn() })),
  };

  const monaco = {
    KeyMod: { CtrlCmd: 1 << 11, Shift: 1 << 10 },
    KeyCode: {
      KeyC: 33,
      KeyX: 54,
      KeyV: 52,
      Delete: 20,
      Insert: 19,
    },
  };

  return {
    commands,
    editor,
    monaco,
    get latestOptions() {
      return latestOptions;
    },
    reset() {
      commands.clear();
      latestOptions = undefined;
      editor.addAction.mockClear();
      editor.addCommand.mockClear();
      editor.focus.mockClear();
      editor.onMouseDown.mockClear();
    },
    setOptions(options: Record<string, unknown> | undefined) {
      latestOptions = options;
    },
  };
});

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');

  return {
    default: ({ beforeMount, onMount, options }: {
      beforeMount?: (monaco: unknown) => void;
      onMount?: (editor: unknown, monaco: unknown) => void;
      options?: Record<string, unknown>;
    }) => {
      editorHarness.setOptions(options);
      React.useLayoutEffect(() => {
        beforeMount?.(editorHarness.monaco);
        onMount?.(editorHarness.editor, editorHarness.monaco);
      }, []);

      return React.createElement('textarea', {
        'aria-label': 'Mock Monaco editor',
      });
    },
  };
});

vi.mock('../hooks/useMonacoJavaCompletions', () => ({ registerJavaCompletions: () => undefined }));
vi.mock('../hooks/useFrontendCompletions', () => ({ useFrontendCompletions: () => undefined }));
vi.mock('../hooks/useMonacoCobolLanguage', () => ({ registerCobolLanguage: () => undefined }));
vi.mock('../hooks/useMonacoCobolCompletions', () => ({ registerCobolCompletions: () => undefined }));
vi.mock('../hooks/useMonacoCCompletions', () => ({ registerCCompletions: () => undefined }));
vi.mock('../hooks/useMonacoCppCompletions', () => ({ registerCppCompletions: () => undefined }));
vi.mock('../hooks/useMonacoPythonCompletions', () => ({ registerPythonCompletions: () => undefined }));

function renderEditor() {
  const attempts = {
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
  };

  render(
    <CodeEditor
      value="answer"
      onChange={() => undefined}
      onCopyAttempt={attempts.copy}
      onCutAttempt={attempts.cut}
      onPasteAttempt={attempts.paste}
    />,
  );

  return attempts;
}

describe('CodeEditor clipboard protection', () => {
  beforeEach(() => {
    editorHarness.reset();
  });

  it('routes Monaco keyboard clipboard commands to the matching attempt callbacks', () => {
    const attempts = renderEditor();
    const { CtrlCmd, Shift } = editorHarness.monaco.KeyMod;
    const { KeyC, KeyX, KeyV, Delete, Insert } = editorHarness.monaco.KeyCode;

    editorHarness.commands.get(CtrlCmd | KeyC)?.();
    editorHarness.commands.get(CtrlCmd | KeyX)?.();
    editorHarness.commands.get(CtrlCmd | KeyV)?.();
    editorHarness.commands.get(Shift | Delete)?.();
    editorHarness.commands.get(CtrlCmd | Insert)?.();
    editorHarness.commands.get(Shift | Insert)?.();

    expect(attempts.copy).toHaveBeenCalledTimes(2);
    expect(attempts.cut).toHaveBeenCalledTimes(2);
    expect(attempts.paste).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['copy', 'copy'],
    ['cut', 'cut'],
    ['paste', 'paste'],
  ] as const)('prevents a native %s event and reports the attempt', (eventType, attemptType) => {
    const attempts = renderEditor();
    const editor = screen.getByRole('textbox', { name: 'Mock Monaco editor' });
    const clipboardEvent = new Event(eventType, { bubbles: true, cancelable: true });

    editor.dispatchEvent(clipboardEvent);

    expect(clipboardEvent.defaultPrevented).toBe(true);
    expect(attempts[attemptType]).toHaveBeenCalledTimes(1);
  });

  it('suppresses mouse context menus without reporting right-click as a violation', () => {
    const attempts = renderEditor();
    const editor = screen.getByRole('textbox', { name: 'Mock Monaco editor' });
    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    editor.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(editorHarness.latestOptions).toMatchObject({ contextmenu: false });
    expect(editorHarness.editor.addAction).not.toHaveBeenCalled();
    expect(attempts.copy).not.toHaveBeenCalled();
    expect(attempts.cut).not.toHaveBeenCalled();
    expect(attempts.paste).not.toHaveBeenCalled();
  });

  it('continues to block dropped text as a paste attempt', () => {
    const attempts = renderEditor();
    const editor = screen.getByRole('textbox', { name: 'Mock Monaco editor' });

    fireEvent.drop(editor);

    expect(attempts.paste).toHaveBeenCalledTimes(1);
  });
});
