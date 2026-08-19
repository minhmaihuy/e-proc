import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodeEditor from './CodeEditor';

interface ModelChangeEvent {
  isFlush: boolean;
  changes: Array<{ text: string }>;
}

const editorHarness = vi.hoisted(() => {
  let currentValue = '';
  let contentListener: ((event: ModelChangeEvent) => void) | null = null;
  let changeListener: ((value: string, event: ModelChangeEvent) => void) | null = null;

  const editor = {
    addAction: () => undefined,
    addCommand: () => undefined,
    focus: () => undefined,
    getValue: () => currentValue,
    onDidChangeModelContent: (listener: (event: ModelChangeEvent) => void) => {
      contentListener = listener;
      return { dispose: () => { contentListener = null; } };
    },
    onMouseDown: () => ({ dispose: () => undefined }),
  };

  const monaco = {
    KeyMod: { CtrlCmd: 1, Shift: 2 },
    KeyCode: new Proxy<Record<string, number>>({}, { get: () => 4 }),
  };

  return {
    editor,
    monaco,
    reset() {
      currentValue = '';
      contentListener = null;
      changeListener = null;
    },
    setChangeListener(listener: ((value: string, event: ModelChangeEvent) => void) | null) {
      changeListener = listener;
    },
    setInitialValue(value: string) {
      currentValue = value;
    },
    applyControlledValue(value: string) {
      if (value === currentValue) return;
      currentValue = value;
      contentListener?.({ isFlush: false, changes: [{ text: value }] });
    },
    emitUserInsertion(text: string) {
      currentValue += text;
      const event = { isFlush: false, changes: [{ text }] };
      contentListener?.(event);
      changeListener?.(currentValue, event);
    },
  };
});

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');

  return {
    default: ({ value, beforeMount, onMount, onChange }: {
      value?: string;
      beforeMount?: (monaco: unknown) => void;
      onMount?: (editor: unknown, monaco: unknown) => void;
      onChange?: (value: string, event: ModelChangeEvent) => void;
    }) => {
      const mountedRef = React.useRef(false);
      editorHarness.setChangeListener(onChange ?? null);

      React.useLayoutEffect(() => {
        const nextValue = value ?? '';
        if (!mountedRef.current) {
          editorHarness.setInitialValue(nextValue);
          beforeMount?.(editorHarness.monaco);
          onMount?.(editorHarness.editor, editorHarness.monaco);
          mountedRef.current = true;
          return;
        }

        // @monaco-editor/react 4.7 uses executeEdits for controlled value changes.
        // Monaco reports that replacement as a non-flush content event.
        editorHarness.applyControlledValue(nextValue);
      }, [value]);

      return React.createElement('div', { 'data-testid': 'mock-monaco-editor' });
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

function props(value: string, onSuspiciousPaste: (preview: string, length: number) => void) {
  return {
    value,
    onChange: () => undefined,
    onCopyAttempt: () => undefined,
    onCutAttempt: () => undefined,
    onPasteAttempt: () => undefined,
    onSuspiciousPaste,
  };
}

describe('CodeEditor answer review', () => {
  beforeEach(() => {
    editorHarness.reset();
  });

  it('ignores a long restored answer without consuming the real-paste signal', () => {
    const onSuspiciousPaste = vi.fn();
    const { rerender } = render(<CodeEditor {...props('', onSuspiciousPaste)} />);
    const savedAnswer = 'saved answer '.repeat(40);

    rerender(<CodeEditor {...props(savedAnswer, onSuspiciousPaste)} />);

    expect(savedAnswer.length).toBeGreaterThanOrEqual(300);
    expect(onSuspiciousPaste).not.toHaveBeenCalled();

    const insertedText = 'x'.repeat(350);
    act(() => editorHarness.emitUserInsertion(insertedText));

    expect(onSuspiciousPaste).toHaveBeenCalledTimes(1);
    expect(onSuspiciousPaste).toHaveBeenCalledWith(insertedText, insertedText.length);
  });

  it('keeps the preview bounded for a user-originated large insertion', () => {
    const onSuspiciousPaste = vi.fn();
    render(<CodeEditor {...props('', onSuspiciousPaste)} />);
    const insertedText = 'x'.repeat(650);

    act(() => editorHarness.emitUserInsertion(insertedText));

    expect(onSuspiciousPaste).toHaveBeenCalledTimes(1);
    expect(onSuspiciousPaste).toHaveBeenCalledWith(insertedText.slice(0, 500), insertedText.length);
  });
});
