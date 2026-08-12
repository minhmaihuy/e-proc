import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { adminApi } from '../services/api';
import AdminNav from '../components/AdminNav';

interface PracticeExamRow {
  id: number;
  name: string;
  created_at: string;
  batches_count: number;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === 'string' ? response.data.error : fallback;
}

function PracticeManagement() {
  const [practices, setPractices] = useState<PracticeExamRow[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const closePreviewRef = useRef<HTMLButtonElement>(null);
  // Nút đã mở modal, để trả tiêu điểm về đúng chỗ khi đóng. Không có nó, người dùng
  // bàn phím bị ném về đầu trang và phải Tab lại từ đầu bảng.
  const previewOpenerRef = useRef<HTMLElement | null>(null);

  const nameFieldId = useId();
  const fileFieldId = useId();
  const previewTitleId = useId();

  const loadPractices = useCallback(async () => {
    try {
      const res = await adminApi.getPracticeExams();
      setPractices(res.data);
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Failed to load practice exams'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPractices();
  }, [loadPractices]);

  const closePreview = useCallback(() => {
    setPreviewHtml(null);
    previewOpenerRef.current?.focus();
    previewOpenerRef.current = null;
  }, []);

  // Escape phải đóng được modal: trước đây chỉ click vào nền mới đóng, nên người dùng
  // bàn phím không có cách nào thoát ra.
  useEffect(() => {
    if (previewHtml === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview();
    };
    document.addEventListener('keydown', onKeyDown);
    closePreviewRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [previewHtml, closePreview]);

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!file) {
      setError('Please choose a .docx file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name.trim());
      const res = await adminApi.importPractice(formData);
      setSuccess(`Imported “${res.data.name}” successfully`);
      setName('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadPractices();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Import failed'));
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (row: PracticeExamRow, opener: HTMLElement | null) => {
    setError('');
    previewOpenerRef.current = opener;
    try {
      const res = await adminApi.getPracticeExam(row.id);
      setPreviewName(res.data.name);
      setPreviewHtml(res.data.content_html);
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Failed to load preview'));
    }
  };

  const handleDelete = async (row: PracticeExamRow) => {
    if (!window.confirm(`Delete practice exam “${row.name}”? This cannot be undone.`)) return;
    setError('');
    setSuccess('');
    try {
      await adminApi.deletePracticeExam(row.id);
      setSuccess(`Deleted “${row.name}”`);
      await loadPractices();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Failed to delete'));
    }
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <span className="eyebrow">ASSESSMENT CONTENT</span>
          <h1>Practice Exams</h1>
        </div>
        <Link to="/admin/dashboard" className="btn btn-secondary">Back to Dashboard</Link>
      </div>

      <AdminNav />

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      <div className="card max-w-2xl">
        <div className="section-heading">
          <div>
            <span className="eyebrow">IMPORT</span>
            <h2>Practice exam (.docx)</h2>
          </div>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Upload một file đề practice (ví dụ Practice_M3.docx). Toàn bộ nội dung file sẽ
          hiển thị cho học viên làm bài tại trang <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-blue-700">/practice</code>.
        </p>
        <form onSubmit={handleImport}>
          <div className="form-group">
            <label htmlFor={nameFieldId}>
              Name <span className="font-normal text-xs text-slate-500">(để trống sẽ lấy theo tên file)</span>
            </label>
            <input
              id={nameFieldId}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Practice M3 — Embedded C"
              disabled={uploading}
            />
          </div>
          <div className="form-group">
            <label htmlFor={fileFieldId}>File (.docx)</label>
            <input
              id={fileFieldId}
              ref={fileInputRef}
              type="file"
              accept=".docx"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              disabled={uploading}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
            {uploading ? 'Importing…' : 'Import'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LIBRARY</span>
            <h2>Imported practice exams</h2>
          </div>
          <span className="count-pill">{practices.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Used by batches</th>
                <th>Imported</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="py-10 text-center text-slate-500">Loading…</td></tr>
              )}
              {!loading && practices.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-500">
                    No practice exams imported yet.
                  </td>
                </tr>
              )}
              {practices.map((practice) => {
                const inUse = Number(practice.batches_count) > 0;
                return (
                  <tr key={practice.id}>
                    <td className="tabular-nums text-slate-500">{practice.id}</td>
                    <td className="font-medium text-slate-900">{practice.name}</td>
                    <td>
                      {inUse
                        ? <span className="status-badge status-active">{practice.batches_count}</span>
                        : <span className="text-slate-400">0</span>}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {new Date(practice.created_at).toLocaleString()}
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="btn btn-secondary text-xs"
                          onClick={(event) => void handlePreview(practice, event.currentTarget)}
                        >
                          Preview
                        </button>
                        <button
                          className="btn btn-danger-outline text-xs"
                          onClick={() => void handleDelete(practice)}
                          disabled={inUse}
                          title={inUse ? 'In use by batches — delete those batches first' : undefined}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {previewHtml !== null && (
        <div className="modal-backdrop" onClick={closePreview}>
          {/* Lớp trong chặn nổi bọt để click vào nội dung không đóng modal. Nền ngoài
              vẫn đóng được, và Escape cũng đóng — xem effect phía trên. */}
          <div
            className="modal-card max-w-4xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id={previewTitleId} className="text-lg font-semibold text-slate-900">{previewName}</h2>
              <button ref={closePreviewRef} className="btn btn-secondary" onClick={closePreview}>
                Close
              </button>
            </div>
            <div
              className="question-content"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default PracticeManagement;
