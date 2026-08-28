import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudentExam from './StudentExam';

const apiMocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  getQuestions: vi.fn(),
  reportViolation: vi.fn(),
  saveAnswer: vi.fn(),
  startExam: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('../services/api', () => ({
  studentApi: apiMocks,
}));

vi.mock('../services/examRecorder', () => ({
  isActive: () => true,
  requestSetup: vi.fn().mockResolvedValue({ ok: true }),
  setOnRecordingStopped: vi.fn(),
  start: vi.fn(),
  stopAndSave: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/examEnvironment', () => ({
  getExamEnvironmentSnapshot: () => ({
    platform: 'test',
    screenCheckSupported: true,
    screenExtended: false,
    screenWidth: 1920,
    screenHeight: 1080,
    devicePixelRatio: 1,
  }),
}));

vi.mock('../components/CodeEditor', async () => {
  const React = await import('react');

  return {
    default: React.forwardRef(function MockCodeEditor({
      value,
      onChange,
      onCopyAttempt,
    }: {
      value: string;
      onChange: (value: string) => void;
      onCopyAttempt: () => void;
    }, ref: React.ForwardedRef<{ focus(): void }>) {
      React.useImperativeHandle(ref, () => ({ focus: () => undefined }));
      return (
        <div>
          <textarea
            aria-label="Answer editor"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <button type="button" onClick={onCopyAttempt}>Simulate editor copy</button>
        </div>
      );
    }),
    detectLanguage: () => 'plaintext',
  };
});

const firstSavedAnswer = 'First saved answer. '.repeat(24);
const secondSavedAnswer = 'Second saved answer. '.repeat(24);

function renderExam() {
  return render(
    <MemoryRouter initialEntries={['/exam']}>
      <Routes>
        <Route path="/" element={<div>Student login</div>} />
        <Route path="/exam" element={<StudentExam />} />
        <Route path="/submit" element={<div>Submission complete</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentExam answered-question mouse navigation', () => {
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
    localStorage.setItem('studentToken', 'test-student-token');
    localStorage.setItem('duration', '60');
    localStorage.setItem('recordMode', 'none');

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
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    });

    apiMocks.getQuestions.mockResolvedValue({
      data: {
        questions: [
          {
            id: 'Q1',
            question_order: 1,
            question_sample: '<p>Question one</p>',
            module: 'Review',
            level: 'Easy',
            type: 'Essay',
            answer: firstSavedAnswer,
          },
          {
            id: 'Q2',
            question_order: 2,
            question_sample: '<p>Question two</p>',
            module: 'Review',
            level: 'Easy',
            type: 'Essay',
            answer: secondSavedAnswer,
          },
        ],
        time_remaining: 3600,
      },
    });
    apiMocks.saveAnswer.mockResolvedValue({ data: { success: true } });
    apiMocks.submit.mockResolvedValue({ data: { success: true } });
    apiMocks.reportViolation.mockResolvedValue({
      data: {
        violation_count: 1,
        total_violations: 1,
        locked: false,
      },
    });
  });

  it('keeps edits while numbered, Previous, and Next clicks remain silent', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderExam();

    const editor = await screen.findByRole('textbox', { name: 'Answer editor' });
    const firstUpdate = `${firstSavedAnswer} Added on first review.`;
    fireEvent.change(editor, { target: { value: firstUpdate } });

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByRole('textbox', { name: 'Answer editor' })).toHaveValue(secondSavedAnswer);

    const secondUpdate = `${secondSavedAnswer} Added on second review.`;
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer editor' }), {
      target: { value: secondUpdate },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('textbox', { name: 'Answer editor' })).toHaveValue(firstUpdate);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('textbox', { name: 'Answer editor' })).toHaveValue(secondUpdate);

    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByRole('textbox', { name: 'Answer editor' })).toHaveValue(firstUpdate);

    expect(apiMocks.reportViolation).not.toHaveBeenCalled();
    expect(apiMocks.submit).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Rule Violation')).not.toBeInTheDocument();
    expect(screen.queryByText(/violation\(s\) recorded/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Exam Locked')).not.toBeInTheDocument();
    expect(screen.queryByText('Copy, cut, and paste are not allowed during the exam.')).not.toBeInTheDocument();
  });

  it('still reports a genuine editor copy attempt after question navigation', async () => {
    renderExam();
    await screen.findByRole('textbox', { name: 'Answer editor' });

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(apiMocks.reportViolation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate editor copy' }));

    expect(await screen.findByText('Copy, cut, and paste are not allowed during the exam.')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.reportViolation).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.reportViolation).toHaveBeenCalledWith('copy_attempt', undefined);
    expect(apiMocks.submit).not.toHaveBeenCalled();
  });

  it('blocks and logs Ctrl+C when focus is on question content outside Monaco', async () => {
    renderExam();
    const questionContent = await screen.findByText('Question one');

    const browserAllowedDefault = fireEvent.keyDown(questionContent, {
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
    });

    expect(browserAllowedDefault).toBe(false);
    expect(await screen.findByText('Copy, cut, and paste are not allowed during the exam.')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.reportViolation).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.reportViolation).toHaveBeenCalledWith('copy_attempt', undefined);
    expect(apiMocks.submit).not.toHaveBeenCalled();
  });

  it('keeps Ctrl+Shift+C classified as DevTools instead of clipboard copy', async () => {
    renderExam();
    const questionContent = await screen.findByText('Question one');

    const browserAllowedDefault = fireEvent.keyDown(questionContent, {
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(browserAllowedDefault).toBe(false);
    await waitFor(() => {
      expect(apiMocks.reportViolation).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.reportViolation).toHaveBeenCalledWith('devtools_open', undefined);
    expect(apiMocks.reportViolation).not.toHaveBeenCalledWith('copy_attempt', undefined);
  });
});
