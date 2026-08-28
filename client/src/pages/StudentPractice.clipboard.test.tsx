import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudentPractice from './StudentPractice';

const apiMocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  getPractice: vi.fn(),
  recordLocalCodeRun: vi.fn(),
  reportViolation: vi.fn(),
  runCode: vi.fn(),
  savePracticeAnswer: vi.fn(),
  submitPractice: vi.fn(),
}));

vi.mock('../services/api', () => ({
  studentApi: apiMocks,
}));

vi.mock('../services/localRunner', () => ({
  canRunLocally: () => false,
  runLocally: vi.fn(),
}));

vi.mock('../components/CodeEditor', async () => {
  const React = await import('react');

  return {
    default: React.forwardRef(function MockCodeEditor({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }, ref: React.ForwardedRef<{ focus(): void; getLanguage(): 'plaintext' }>) {
      React.useImperativeHandle(ref, () => ({
        focus: () => undefined,
        getLanguage: () => 'plaintext',
      }));
      return (
        <textarea
          aria-label="Practice answer editor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }),
    detectLanguage: () => 'plaintext',
  };
});

function renderPractice() {
  return render(
    <MemoryRouter initialEntries={['/practice']}>
      <Routes>
        <Route path="/" element={<div>Student login</div>} />
        <Route path="/practice" element={<StudentPractice />} />
        <Route path="/submit" element={<div>Submission complete</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentPractice whole-page clipboard protection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());

    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, String(value)); },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    localStorage.setItem('studentId', '42');
    localStorage.setItem('studentToken', 'practice-student-token');
    localStorage.setItem('duration', '60');

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.documentElement,
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    apiMocks.getPractice.mockResolvedValue({
      data: {
        practice: {
          id: 7,
          name: 'Clipboard Practice',
          content_html: '<p>Practice requirement content</p>',
        },
        answer: 'Existing practice answer',
        time_remaining: 3600,
        compiler_mode: 'local',
        compiler_languages: [],
      },
    });
    apiMocks.reportViolation.mockResolvedValue({
      data: {
        violation_count: 1,
        total_violations: 1,
        locked: false,
      },
    });
    apiMocks.savePracticeAnswer.mockResolvedValue({ data: { success: true } });
    apiMocks.submitPractice.mockResolvedValue({ data: { success: true } });
  });

  it('blocks and logs Ctrl+V when focus is on the Practice requirement', async () => {
    renderPractice();
    const requirement = await screen.findByText('Practice requirement content');

    const browserAllowedDefault = fireEvent.keyDown(requirement, {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
    });

    expect(browserAllowedDefault).toBe(false);
    expect(await screen.findByText('Copy, cut, and paste are not allowed during the exam.')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.reportViolation).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.reportViolation).toHaveBeenCalledWith('paste_attempt', undefined);
    expect(apiMocks.submitPractice).not.toHaveBeenCalled();
  });

  it('keeps Cmd+Option+C classified as DevTools instead of clipboard copy', async () => {
    renderPractice();
    const requirement = await screen.findByText('Practice requirement content');

    const browserAllowedDefault = fireEvent.keyDown(requirement, {
      key: 'c',
      code: 'KeyC',
      metaKey: true,
      altKey: true,
    });

    expect(browserAllowedDefault).toBe(false);
    await waitFor(() => {
      expect(apiMocks.reportViolation).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.reportViolation).toHaveBeenCalledWith('devtools_open', undefined);
    expect(apiMocks.reportViolation).not.toHaveBeenCalledWith('copy_attempt', undefined);
    expect(apiMocks.submitPractice).not.toHaveBeenCalled();
  });
});
