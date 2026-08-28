import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyClipboardShortcut,
  type ClipboardViolationType,
  useExamClipboardProtection,
} from './useExamClipboardProtection';

function Harness({
  active,
  onAttempt,
}: {
  active: boolean;
  onAttempt: (type: ClipboardViolationType) => void;
}) {
  useExamClipboardProtection({ active, onAttempt });
  return <button type="button">Outside editor</button>;
}

describe('classifyClipboardShortcut', () => {
  const cases: Array<{
    name: string;
    init: KeyboardEventInit;
    expected: ClipboardViolationType;
  }> = [
    { name: 'Ctrl+C', init: { key: 'c', ctrlKey: true }, expected: 'copy_attempt' },
    { name: 'Cmd+C', init: { key: 'c', metaKey: true }, expected: 'copy_attempt' },
    { name: 'Ctrl+Insert', init: { key: 'Insert', ctrlKey: true }, expected: 'copy_attempt' },
    { name: 'Ctrl+X', init: { key: 'x', ctrlKey: true }, expected: 'cut_attempt' },
    { name: 'Cmd+X', init: { key: 'x', metaKey: true }, expected: 'cut_attempt' },
    { name: 'Shift+Delete', init: { key: 'Delete', shiftKey: true }, expected: 'cut_attempt' },
    { name: 'Ctrl+V', init: { key: 'v', ctrlKey: true }, expected: 'paste_attempt' },
    { name: 'Cmd+V', init: { key: 'v', metaKey: true }, expected: 'paste_attempt' },
    { name: 'Ctrl+Shift+V', init: { key: 'v', ctrlKey: true, shiftKey: true }, expected: 'paste_attempt' },
    { name: 'Cmd+Shift+V', init: { key: 'v', metaKey: true, shiftKey: true }, expected: 'paste_attempt' },
    {
      name: 'Cmd+Option+Shift+V',
      init: { key: 'v', metaKey: true, altKey: true, shiftKey: true },
      expected: 'paste_attempt',
    },
    { name: 'Shift+Insert', init: { key: 'Insert', shiftKey: true }, expected: 'paste_attempt' },
  ];

  it.each(cases)('maps $name to $expected', ({ init, expected }) => {
    expect(classifyClipboardShortcut(new KeyboardEvent('keydown', init))).toBe(expected);
  });

  it.each([
    ['Ctrl+Shift+C', { key: 'c', ctrlKey: true, shiftKey: true }],
    ['Cmd+Option+C', { key: 'c', metaKey: true, altKey: true }],
    ['Ctrl+A', { key: 'a', ctrlKey: true }],
    ['an auto-repeat', { key: 'c', ctrlKey: true, repeat: true }],
  ])('ignores %s', (_name, init) => {
    expect(classifyClipboardShortcut(new KeyboardEvent('keydown', init))).toBeNull();
  });
});

describe('useExamClipboardProtection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks a supported shortcut at document capture and reports it once', () => {
    const onAttempt = vi.fn();
    const { getByRole } = render(<Harness active onAttempt={onAttempt} />);

    const browserAllowedDefault = fireEvent.keyDown(getByRole('button'), {
      key: 'c',
      ctrlKey: true,
      cancelable: true,
    });

    expect(browserAllowedDefault).toBe(false);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith('copy_attempt');
  });

  it.each([
    ['copy', 'copy_attempt'],
    ['cut', 'cut_attempt'],
    ['paste', 'paste_attempt'],
  ] as const)('blocks native %s events and reports %s', (eventName, expected) => {
    const onAttempt = vi.fn();
    const { getByRole, unmount } = render(<Harness active onAttempt={onAttempt} />);
    const event = new Event(eventName, { bubbles: true, cancelable: true });

    getByRole('button').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(expected);
    unmount();
  });

  it('does not block while inactive and removes listeners on unmount', () => {
    const onAttempt = vi.fn();
    const { getByRole, rerender, unmount } = render(
      <Harness active={false} onAttempt={onAttempt} />,
    );

    expect(fireEvent.keyDown(getByRole('button'), { key: 'v', ctrlKey: true })).toBe(true);
    expect(onAttempt).not.toHaveBeenCalled();

    rerender(<Harness active onAttempt={onAttempt} />);
    unmount();
    const eventAfterUnmount = new KeyboardEvent('keydown', {
      key: 'v',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(eventAfterUnmount);

    expect(eventAfterUnmount.defaultPrevented).toBe(false);
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it('leaves DevTools shortcuts for the page-level DevTools handler', () => {
    const onAttempt = vi.fn();
    const { getByRole } = render(<Harness active onAttempt={onAttempt} />);

    expect(fireEvent.keyDown(getByRole('button'), {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
    })).toBe(true);
    expect(onAttempt).not.toHaveBeenCalled();
  });
});
