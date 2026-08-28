import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { studentApi } from '../services/api';
import CodeEditor, { detectLanguage } from '../components/CodeEditor';
import type { CodeEditorHandle } from '../components/CodeEditor';
import { canRunLocally, runLocally } from '../services/localRunner';
import { RapidInsertionDetector } from '../services/rapidInsertionDetector';
import { useExamClipboardProtection } from '../hooks/useExamClipboardProtection';

// Static import matches StudentExam. detectLanguage already loads this module, while a
// lazy import string is mangled by the production obfuscator into /components/CodeEditor.

const CLIPBOARD_VIOLATION_COOLDOWN_MS = 3000;
const FULLSCREEN_EXIT_TIMEOUT_MS = 5000;

interface PracticeInfo {
  id: number;
  name: string;
  content_html: string;
}

interface RunResult {
  ok: boolean;
  phase: 'setup' | 'compile' | 'run';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  ranLocally?: boolean;
  runner?: 'lambda';
}

// Local-first: python/c/cpp chạy ngay trong trình duyệt học viên (localRunner.ts,
// 0 request lên server); cobol/java không có runtime browser nên vẫn qua server
// (POST /student/run — có thể tắt bằng env ENABLE_SERVER_CODE_RUN=false).
const SERVER_RUN_LANGUAGES = ['cobol', 'java'];

type BlockReason = 'timeout' | 'absent_too_long' | 'submitted';

// Trang thi Practice: 1 đề dài import từ .docx (hiển thị bên trái) + 1 bài làm
// duy nhất trong code editor (bên phải). Tái dùng toàn bộ cơ chế anti-cheat,
// timer và violation của trang thi thường (StudentExam.tsx).
function StudentPractice() {
  const [practice, setPractice] = useState<PracticeInfo | null>(null);
  const [answer, setAnswer] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [violationCount, setViolationCount] = useState(0);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clipboardWarning, setClipboardWarning] = useState('');
  const [violationWarningModal, setViolationWarningModal] = useState('');
  const [resumeInfo, setResumeInfo] = useState<{ timeLeft: number } | null>(null);
  const [blockedReason, setBlockedReason] = useState<BlockReason | null>(null);
  // Run code: học viên tự kiểm tra kết quả trước khi nộp
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState('');
  const [compilerMode, setCompilerMode] = useState<'local' | 'lambda'>('local');
  const [compilerLanguages, setCompilerLanguages] = useState<string[]>([]);
  const editorRef = useRef<CodeEditorHandle>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const clipboardCooldownRef = useRef<Record<string, number>>({});
  const clipboardWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const violationWarningModalTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fullscreenExitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fullscreenAutoSubmitTriggeredRef = useRef(false);
  const devtoolsViolationCooldownRef = useRef<number>(0);
  const startedRef = useRef(false);
  const lockedRef = useRef(false);
  const submittingRef = useRef(false);
  const lastViolationTimeRef = useRef<number>(0);
  const rapidInsertionDetectorRef = useRef(new RapidInsertionDetector());
  const answerRef = useRef('');
  const navigate = useNavigate();

  const studentId = localStorage.getItem('studentId');
  const studentToken = localStorage.getItem('studentToken');

  useEffect(() => {
    if (!studentId || !studentToken) {
      navigate('/');
      return;
    }

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    }

    const initPractice = async () => {
      try {
        // GET /student/practice tự start (set deadline) ở lần gọi đầu
        const res = await studentApi.getPractice();
        setStarted(true);
        loadPractice(res.data);
      } catch (error: any) {
        if (error.response?.status === 410) {
          const reason: BlockReason = error.response.data?.reason ?? 'submitted';
          setBlockedReason(reason);
          setLoading(false);
          document.exitFullscreen().catch(() => { });
          return;
        }
        alert('Error: ' + (error.response?.data?.error || error.message));
        navigate('/');
      }
    };

    initPractice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, studentId]);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  // Gửi beacon khi học viên tắt trình duyệt / đóng tab (dùng chung endpoint với exam)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (startedRef.current && !submittingRef.current && !lockedRef.current) {
        studentApi.disconnect();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const clearFullscreenExitTimeout = useCallback(() => {
    if (fullscreenExitTimeoutRef.current) {
      clearTimeout(fullscreenExitTimeoutRef.current);
      fullscreenExitTimeoutRef.current = null;
    }
  }, []);

  const handleSubmit = useCallback(async (force = false) => {
    if (submittingRef.current) return;
    if (!force && !confirm('Are you sure you want to submit?')) return;

    setSubmitting(true);
    try {
      await studentApi.submitPractice();
      document.exitFullscreen().catch(() => { });
      navigate('/submit');
    } catch (error) {
      console.error(error);
      alert('Error submitting exam. Please contact support.');
      setSubmitting(false);
    }
  }, [navigate]);

  const handleViolation = useCallback(async (
    type: string,
    meta?: { textLength?: number; metadata?: Record<string, number> },
  ): Promise<boolean> => {
    const now = Date.now();
    if (now - lastViolationTimeRef.current < 3000) {
      return false;
    }
    lastViolationTimeRef.current = now;

    try {
      const res = await studentApi.reportViolation(type, meta);
      setViolationCount(res.data.total_violations);
      if (res.data.locked) {
        setLocked(true);
        clearFullscreenExitTimeout();
        document.exitFullscreen().catch(() => { });
        alert('You have violated the exam rules. Your exam has been locked.');
        await handleSubmit(true);
        return true;
      } else {
        const warningByType: Record<string, string> = {
          fullscreen_exit: 'You exited fullscreen',
          tab_switch: 'You switched tabs',
          copy_attempt: 'You attempted to copy text',
          cut_attempt: 'You attempted to cut text',
          paste_attempt: 'You attempted to paste text',
          devtools_open: 'You attempted to open Developer Tools'
        };
        const warning = warningByType[type] || 'You violated the exam rules';

        setViolationWarningModal(`Warning: ${warning}. This is violation ${res.data.violation_count}. After 2 violations, your exam will be locked.`);
        if (violationWarningModalTimeoutRef.current) {
          clearTimeout(violationWarningModalTimeoutRef.current);
        }
        violationWarningModalTimeoutRef.current = setTimeout(() => {
          setViolationWarningModal('');
        }, 5000);

        lastViolationTimeRef.current = Date.now();
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    }
  }, [clearFullscreenExitTimeout, handleSubmit]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!startedRef.current || lockedRef.current || submittingRef.current) {
        clearFullscreenExitTimeout();
        return;
      }

      if (document.fullscreenElement) {
        clearFullscreenExitTimeout();
        fullscreenAutoSubmitTriggeredRef.current = false;
        return;
      }

      if (fullscreenExitTimeoutRef.current || fullscreenAutoSubmitTriggeredRef.current) {
        return;
      }

      fullscreenExitTimeoutRef.current = setTimeout(async () => {
        fullscreenExitTimeoutRef.current = null;

        if (!startedRef.current || lockedRef.current || submittingRef.current) return;
        if (document.fullscreenElement) return;
        if (fullscreenAutoSubmitTriggeredRef.current) return;

        fullscreenAutoSubmitTriggeredRef.current = true;
        const wasLocked = await handleViolation('fullscreen_exit');

        if (wasLocked) return;

        if (!document.fullscreenElement) {
          fullscreenExitTimeoutRef.current = setTimeout(async () => {
            fullscreenExitTimeoutRef.current = null;
            if (!startedRef.current || lockedRef.current || submittingRef.current) return;
            if (document.fullscreenElement) return;

            await handleViolation('fullscreen_exit');
          }, FULLSCREEN_EXIT_TIMEOUT_MS);
        }
      }, FULLSCREEN_EXIT_TIMEOUT_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden && startedRef.current && !lockedRef.current && !submittingRef.current) {
        void handleViolation('tab_switch');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearFullscreenExitTimeout();
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearFullscreenExitTimeout, handleSubmit, handleViolation]);

  const triggerDevtoolsViolation = useCallback(() => {
    if (!startedRef.current || lockedRef.current || submittingRef.current) return;
    const now = Date.now();
    if (now - devtoolsViolationCooldownRef.current < 10000) return; // 10s cooldown
    devtoolsViolationCooldownRef.current = now;
    void handleViolation('devtools_open');
  }, [handleViolation]);

  // Chặn phím tắt mở DevTools và context menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!startedRef.current || lockedRef.current || submittingRef.current) return;

      const isF12 = e.key === 'F12';
      const key = e.key.toLowerCase();
      const isCtrlShiftI = e.ctrlKey && e.shiftKey && key === 'i';
      const isCtrlShiftJ = e.ctrlKey && e.shiftKey && key === 'j';
      const isCtrlShiftC = e.ctrlKey && e.shiftKey && key === 'c';
      const isCtrlShiftK = e.ctrlKey && e.shiftKey && key === 'k';
      const isMacDevtools = e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key);
      const isCtrlU = e.ctrlKey && key === 'u';

      if (e.key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => { });
        } else {
          document.exitFullscreen().catch(() => { });
        }
        return;
      }

      if (isF12 || isCtrlShiftI || isCtrlShiftJ || isCtrlShiftC || isCtrlShiftK || isMacDevtools || isCtrlU) {
        e.preventDefault();
        e.stopPropagation();
        triggerDevtoolsViolation();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (startedRef.current && !lockedRef.current && !submittingRef.current) {
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [triggerDevtoolsViolation]);

  useEffect(() => {
    if (locked || submitting) {
      clearFullscreenExitTimeout();
    }
    if (locked) {
      fullscreenAutoSubmitTriggeredRef.current = true;
    }
  }, [clearFullscreenExitTimeout, locked, submitting]);

  useEffect(() => {
    if (!started) {
      fullscreenAutoSubmitTriggeredRef.current = false;
    }
  }, [started]);

  useEffect(() => {
    return () => {
      clearFullscreenExitTimeout();
    };
  }, [clearFullscreenExitTimeout]);

  useEffect(() => {
    if (started && !locked) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            handleSubmit(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [handleSubmit, locked, started]);

  useEffect(() => {
    return () => {
      if (clipboardWarningTimeoutRef.current) {
        clearTimeout(clipboardWarningTimeoutRef.current);
      }
    };
  }, []);

  const loadPractice = (data: any) => {
    setPractice(data.practice);
    answerRef.current = data.answer || '';
    setAnswer(answerRef.current);
    setCompilerMode(data.compiler_mode === 'lambda' ? 'lambda' : 'local');
    setCompilerLanguages(Array.isArray(data.compiler_languages) ? data.compiler_languages : []);

    const serverTimeRemaining: number | null = data.time_remaining ?? null;
    if (serverTimeRemaining !== null && serverTimeRemaining > 0) {
      setTimeLeft(serverTimeRemaining);
      const fullDuration = parseInt(localStorage.getItem('duration') || '30') * 60;
      if (serverTimeRemaining < fullDuration - 5) {
        setResumeInfo({ timeLeft: serverTimeRemaining });
      }
    } else if (serverTimeRemaining === null) {
      const duration = parseInt(localStorage.getItem('duration') || '30');
      setTimeLeft(duration * 60);
    }

    setLoading(false);

    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const showClipboardWarning = useCallback((message: string) => {
    setClipboardWarning(message);
    if (clipboardWarningTimeoutRef.current) {
      clearTimeout(clipboardWarningTimeoutRef.current);
    }
    clipboardWarningTimeoutRef.current = setTimeout(() => {
      setClipboardWarning('');
    }, 2500);
  }, []);

  const handleClipboardAttempt = useCallback((type: 'copy_attempt' | 'cut_attempt' | 'paste_attempt') => {
    if (!started || locked || submitting) return;

    showClipboardWarning('Copy, cut, and paste are not allowed during the exam.');

    const now = Date.now();
    const lastTriggeredAt = clipboardCooldownRef.current[type] || 0;
    if (now - lastTriggeredAt < CLIPBOARD_VIOLATION_COOLDOWN_MS) {
      return;
    }

    clipboardCooldownRef.current[type] = now;
    void handleViolation(type);
  }, [handleViolation, locked, showClipboardWarning, started, submitting]);

  useExamClipboardProtection({
    active: started && !locked && !submitting,
    onAttempt: handleClipboardAttempt,
  });

  const handleCopyAttempt  = useCallback(() => handleClipboardAttempt('copy_attempt'),  [handleClipboardAttempt]);
  const handleCutAttempt   = useCallback(() => handleClipboardAttempt('cut_attempt'),   [handleClipboardAttempt]);
  const handlePasteAttempt = useCallback(() => handleClipboardAttempt('paste_attempt'), [handleClipboardAttempt]);

  const saveAnswer = useCallback((text: string) => {
    const rapidInsertion = rapidInsertionDetectorRef.current.observe(answerRef.current, text);
    answerRef.current = text;
    if (rapidInsertion && startedRef.current && !lockedRef.current && !submittingRef.current) {
      void handleViolation('rapid_text_insertion', {
        textLength: rapidInsertion.insertedChars,
        metadata: { ...rapidInsertion },
      });
    }
    setAnswer(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      studentApi.savePracticeAnswer(text).catch(console.error);
    }, 2000);
  }, [handleViolation]);

  // Chạy code để kiểm tra output — ưu tiên chạy NGAY TRONG TRÌNH DUYỆT
  // (python/c/cpp, không tốn tài nguyên server); cobol/java mới gọi server.
  const handleRun = useCallback(async () => {
    if (running || locked || submitting) return;

    const language = editorRef.current?.getLanguage() ?? 'cpp';

    setRunning(true);
    setRunError('');
    setRunResult(null);
    try {
      if (compilerMode === 'lambda') {
        if (!compilerLanguages.includes(language)) {
          setRunError(`Ngôn ngữ "${language}" chưa được hỗ trợ trên Lambda. Hỗ trợ: ${compilerLanguages.join(', ') || 'C, C++, Python, Java'}.`);
          return;
        }
        const res = await studentApi.runCode(language, answer);
        setRunResult(res.data);
      } else if (canRunLocally(language)) {
        const result = await runLocally(language, answer);
        setRunResult(result);
        await studentApi.recordLocalCodeRun(crypto.randomUUID());
      } else if (SERVER_RUN_LANGUAGES.includes(language)) {
        const res = await studentApi.runCode(language, answer);
        setRunResult(res.data);
      } else {
        setRunError(`Ngôn ngữ "${language}" không hỗ trợ chạy thử. Hỗ trợ: C, C++, Python (trên máy bạn), COBOL, Java (trên server).`);
      }
    } catch (err: any) {
      setRunError(err.response?.data?.error || 'Run failed. Please try again.');
    } finally {
      setRunning(false);
    }
  }, [answer, compilerLanguages, compilerMode, locked, running, submitting]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Đoán ngôn ngữ mặc định của editor từ tên đề + phần đầu nội dung đề
  // (ví dụ "Practice_Cobol_M3" → cobol; đề chứa "C/C++" → cpp). Học viên vẫn
  // đổi được qua dropdown. Thay _/- bằng khoảng trắng vì detectLanguage dùng
  // \b (word boundary) mà dấu gạch dưới là word character — "practice_cobol"
  // sẽ không match \bcobol\b nếu giữ nguyên.
  const practiceLanguage = detectLanguage(
    practice?.name.replace(/[_-]+/g, ' '),
    practice?.content_html.replace(/<[^>]*>/g, ' ').replace(/[_-]+/g, ' ').slice(0, 1000)
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="loading">Loading practice exam...</p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-md text-center" role="alert">
          <h2 className="mb-2 text-xl font-bold text-red-600">Exam Locked</h2>
          <p>You have violated exam rules multiple times.</p>
          <p>Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  if (blockedReason) {
    const blockedMessages: Record<BlockReason, { title: string; message: string; icon: string }> = {
      timeout: {
        icon: '⏰',
        title: 'Time\'s Up',
        message: 'Your exam time has expired. Your answers have been automatically submitted.'
      },
      absent_too_long: {
        icon: '🚫',
        title: 'Session Expired',
        message: 'You were absent for more than 2 minutes. Your exam has been automatically submitted to prevent cheating.'
      },
      submitted: {
        icon: '✅',
        title: 'Exam Already Submitted',
        message: 'Your exam has already been submitted. You cannot re-enter the exam.'
      }
    };
    const { icon, title, message } = blockedMessages[blockedReason];
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="card max-w-md text-center" role="alert">
          <div aria-hidden="true" className="mb-4 text-6xl">{icon}</div>
          <h2 className="mb-3 text-xl font-bold text-red-600">{title}</h2>
          <p className="leading-relaxed text-slate-700">{message}</p>
          <p className="mt-5 text-sm text-slate-500">Please contact your administrator if you believe this is an error.</p>
        </div>
      </div>
    );
  }

  if (!practice) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="loading">Loading practice exam...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen select-none bg-slate-50 pb-20">
      {/* Header dinh, cung khuon voi StudentExam de hai trang thi khong lech nhau.
          Dong ho noi cu dinh vi fixed nen de len noi dung o man hinh hep. */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={`flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-lg font-bold tracking-wider ${
                timeLeft < 300
                  ? 'animate-pulse border border-red-200 bg-red-100 text-red-700'
                  : 'bg-slate-900 text-white shadow-md'
              }`}
            >
              <svg className="h-5 w-5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTime(timeLeft)}
            </div>
            <h1 className="truncate text-lg font-semibold text-slate-900">{practice.name}</h1>
          </div>
          <button
            onClick={() => handleSubmit()}
            disabled={submitting}
            className="btn btn-primary shrink-0"
          >
            {submitting ? 'Submitting...' : 'Submit Exam'}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">

        {violationCount > 0 && (
          <div className="violation-warning">
            Warning: {violationCount} violation(s) recorded. After 2 violations, your exam will be locked.
          </div>
        )}

        {clipboardWarning && (
          <div className="violation-warning my-3" role="alert">
            {clipboardWarning}
          </div>
        )}

        <div className="practice-layout">
          {/* Đề bài (từ file .docx) — panel trái, cuộn độc lập */}
          <div className="card practice-content-panel">
            <div
              className="question-content"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(practice.content_html) }}
            />
          </div>

          {/* Bài làm — panel phải */}
          <div className="card practice-editor-panel">
            <div className="form-group mb-0">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <label className="mb-0">Your Answer:</label>
                  {compilerMode === 'lambda' && <span className="status-badge provision-active">AWS Lambda compiler</span>}
                </span>
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={running || locked || submitting || !answer.trim()}
                  className="btn btn-secondary text-[13px]"
                >
                  {running ? '⏳ Running...' : '▶ Run Code'}
                </button>
              </div>
              <Suspense
                fallback={
                  <div className="code-editor-loading-fallback">
                    Loading editor...
                  </div>
                }
              >
                <CodeEditor
                  ref={editorRef}
                  value={answer}
                  onChange={saveAnswer}
                  onCopyAttempt={handleCopyAttempt}
                  onCutAttempt={handleCutAttempt}
                  onPasteAttempt={handlePasteAttempt}
                  defaultLanguage={practiceLanguage}
                  disabled={locked || submitting}
                  height={runResult || runError ? 'calc(100vh - 420px)' : 'calc(100vh - 250px)'}
                />
              </Suspense>

              {runError && (
                <p className="error mt-2.5" role="alert">{runError}</p>
              )}

              {runResult && (
                <div className="run-output-panel">
                  <div className="run-output-header">
                    <strong>
                      {runResult.phase === 'compile'
                        ? '❌ Compile Error'
                        : runResult.timedOut
                          ? '⏱ Time Limit Exceeded'
                          : runResult.ok
                            ? '✅ Output'
                            : `⚠️ Exited with code ${runResult.exitCode}`}
                    </strong>
                    <span className="flex items-center gap-2.5">
                      <span className="text-xs font-normal normal-case text-slate-500">
                        {runResult.durationMs}ms · {runResult.runner === 'lambda' ? 'AWS Lambda' : runResult.ranLocally ? 'chạy trên máy bạn' : 'chạy trên server'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary px-2.5 py-0.5 text-[11px]"
                        onClick={() => setRunResult(null)}
                      >
                        Close
                      </button>
                    </span>
                  </div>
                  <pre className="run-output-body">
                    {[runResult.stdout, runResult.stderr].filter(Boolean).join('\n') || '(no output)'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Violation warning modal toast */}
      {violationWarningModal && (
        <div
          role="alert"
          className="fixed left-1/2 top-5 z-[60] max-w-xl -translate-x-1/2 rounded-xl border-2 border-red-500 bg-red-50 px-6 py-3.5 font-semibold text-red-800 shadow-xl"
        >
          {violationWarningModal}
        </div>
      )}

      {/* Resume notification */}
      {resumeInfo && (
        <div className="modal-backdrop" onClick={() => setResumeInfo(null)}>
          <div
            className="modal-card max-w-sm text-center"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div aria-hidden="true" className="mb-2.5 text-4xl">🔄</div>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Exam Resumed</h2>
            <p className="mb-4 text-slate-500">
              Your session has been restored. Time remaining: <strong>{formatTime(resumeInfo.timeLeft)}</strong>
            </p>
            <button className="btn btn-primary w-full" autoFocus onClick={() => setResumeInfo(null)}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentPractice;
