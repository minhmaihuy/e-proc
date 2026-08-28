import { useEffect } from 'react';

export type ClipboardViolationType = 'copy_attempt' | 'cut_attempt' | 'paste_attempt';

type ClipboardProtectionOptions = {
  active: boolean;
  onAttempt: (type: ClipboardViolationType) => void;
};

/**
 * Classifies browser clipboard shortcuts without stealing combinations that the
 * exam pages reserve for DevTools detection.
 */
export function classifyClipboardShortcut(event: KeyboardEvent): ClipboardViolationType | null {
  if (event.repeat) return null;

  const key = event.key.toLowerCase();
  const commandModifier = event.ctrlKey !== event.metaKey && (event.ctrlKey || event.metaKey);

  // These are browser DevTools shortcuts and must remain devtools_open.
  if (
    (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && key === 'c')
    || (event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey && key === 'c')
  ) {
    return null;
  }

  if (commandModifier && !event.altKey && !event.shiftKey && key === 'c') {
    return 'copy_attempt';
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'insert') {
    return 'copy_attempt';
  }

  if (commandModifier && !event.altKey && !event.shiftKey && key === 'x') {
    return 'cut_attempt';
  }
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && key === 'delete') {
    return 'cut_attempt';
  }

  const isCommandPaste = commandModifier
    && key === 'v'
    && (!event.altKey || (event.metaKey && event.shiftKey));
  if (isCommandPaste) {
    return 'paste_attempt';
  }
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && key === 'insert') {
    return 'paste_attempt';
  }

  return null;
}

/**
 * Owns clipboard protection at the document capture boundary while an exam is
 * active. CodeEditor keeps its Monaco-level guards as defense in depth.
 */
export function useExamClipboardProtection({ active, onAttempt }: ClipboardProtectionOptions): void {
  useEffect(() => {
    if (!active) return undefined;

    const blockEvent = (event: Event, type: ClipboardViolationType) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      onAttempt(type);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const type = classifyClipboardShortcut(event);
      if (type) blockEvent(event, type);
    };
    const handleCopy = (event: ClipboardEvent) => blockEvent(event, 'copy_attempt');
    const handleCut = (event: ClipboardEvent) => blockEvent(event, 'cut_attempt');
    const handlePaste = (event: ClipboardEvent) => blockEvent(event, 'paste_attempt');

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('cut', handleCut, true);
    document.addEventListener('paste', handlePaste, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('cut', handleCut, true);
      document.removeEventListener('paste', handlePaste, true);
    };
  }, [active, onAttempt]);
}
