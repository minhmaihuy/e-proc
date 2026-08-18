import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudentExam from './StudentExam';

const apiMocks = vi.hoisted(() => ({
  getQuestions: vi.fn(),
  startExam: vi.fn(),
}));

vi.mock('../services/api', () => ({
  studentApi: apiMocks,
}));

vi.mock('../components/CodeEditor', () => ({
  default: () => null,
  detectLanguage: () => 'plaintext',
}));

function renderExam() {
  return render(
    <MemoryRouter initialEntries={['/exam']}>
      <Routes>
        <Route path="/" element={<div>Student login</div>} />
        <Route path="/exam" element={<StudentExam />} />
        <Route path="/practice" element={<div>Practice assessment</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentExam Practice fallback routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    apiMocks.getQuestions.mockReset();
    apiMocks.startExam.mockReset();
    localStorage.clear();
    localStorage.setItem('studentId', '42');
    localStorage.setItem('studentToken', 'test-student-token');
    localStorage.setItem('duration', '60');
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('redirects when the initial questions request identifies a Practice batch', async () => {
    apiMocks.getQuestions.mockResolvedValue({
      data: { redirect: 'practice', questions: [], time_remaining: null },
    });

    renderExam();

    expect(await screen.findByText('Practice assessment')).toBeInTheDocument();
    expect(apiMocks.startExam).not.toHaveBeenCalled();
  });

  it('redirects when the start endpoint identifies a Practice batch', async () => {
    apiMocks.getQuestions.mockResolvedValue({
      data: { questions: [], time_remaining: null },
    });
    apiMocks.startExam.mockResolvedValue({
      data: { success: false, redirect: 'practice' },
    });

    renderExam();

    expect(await screen.findByText('Practice assessment')).toBeInTheDocument();
    expect(apiMocks.startExam).toHaveBeenCalledWith(42);
    expect(apiMocks.getQuestions).toHaveBeenCalledTimes(1);
  });

  it('redirects when the follow-up questions request identifies a Practice batch', async () => {
    apiMocks.getQuestions
      .mockResolvedValueOnce({ data: { questions: [], time_remaining: null } })
      .mockResolvedValueOnce({
        data: { redirect: 'practice', questions: [], time_remaining: null },
      });
    apiMocks.startExam.mockResolvedValue({
      data: { success: true, questions_count: 1 },
    });

    renderExam();

    expect(await screen.findByText('Practice assessment')).toBeInTheDocument();
    expect(apiMocks.startExam).toHaveBeenCalledWith(42);
    expect(apiMocks.getQuestions).toHaveBeenCalledTimes(2);
  });

  it('exits the loading state when start succeeds but no questions can be loaded', async () => {
    apiMocks.getQuestions.mockResolvedValue({
      data: { questions: [], time_remaining: null },
    });
    apiMocks.startExam.mockResolvedValue({
      data: { success: true, questions_count: 1 },
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    renderExam();

    expect(await screen.findByText('Student login')).toBeInTheDocument();
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('No questions were assigned'));
    expect(screen.queryByText('Loading questions...')).not.toBeInTheDocument();
  });

  it('renders a bounded message for a concurrent-session lock', async () => {
    apiMocks.getQuestions.mockRejectedValue({
      response: {
        status: 410,
        data: { reason: 'concurrent_session', error: 'Concurrent session' },
      },
    });

    renderExam();

    expect(await screen.findByText('Concurrent Session Detected')).toBeInTheDocument();
    expect(screen.queryByText('Loading questions...')).not.toBeInTheDocument();
  });
});
