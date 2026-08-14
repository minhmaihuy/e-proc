import { useState } from 'react';

/**
 * Bảng kết quả cho đợt thi Practice.
 *
 * Khác hẳn màn hình kết quả thường: đề .docx là MỘT bài duy nhất nên mỗi học viên chỉ
 * có một câu trả lời holistic, không có danh sách câu hỏi để duyệt qua. Vì vậy đây là
 * một dòng mỗi học viên, mở ra panel chấm chứ không phải khung xem theo từng câu.
 */
export interface PracticeResultRow {
  student_id: number;
  email: string;
  status: string;
  violation_count: number;
  answer: string | null;
  ai_score: number | null;
  ai_feedback: string | null;
  trainer_score: number | null;
  trainer_feedback: string | null;
}

interface PracticeResultsTableProps {
  rows: PracticeResultRow[];
  onSave: (studentId: number, score: number, feedback: string) => Promise<void>;
}

function statusTone(status: string): string {
  if (status === 'submitted') return 'bg-emerald-100 text-emerald-800 ring-emerald-300';
  if (status === 'in_progress') return 'bg-blue-100 text-blue-800 ring-blue-300';
  if (status === 'locked') return 'bg-red-100 text-red-800 ring-red-300';
  return 'bg-slate-100 text-slate-600 ring-slate-300';
}

function PracticeResultsTable({ rows, onSave }: PracticeResultsTableProps) {
  const [reviewing, setReviewing] = useState<PracticeResultRow | null>(null);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const openReview = (row: PracticeResultRow) => {
    setReviewing(row);
    // Điểm của giảng viên ưu tiên hơn điểm AI; chưa chấm thì lấy điểm AI làm gợi ý.
    setScore(String(row.trainer_score ?? row.ai_score ?? ''));
    setFeedback(row.trainer_feedback ?? '');
  };

  const save = async () => {
    if (!reviewing) return;
    setSaving(true);
    try {
      await onSave(reviewing.student_id, Number(score), feedback);
      setReviewing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Trạng thái</th>
              <th>Vi phạm</th>
              <th>Điểm AI</th>
              <th>Điểm giảng viên</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-500">
                  Chưa có học viên nào trong đợt thi này.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.student_id}>
                <td className="font-medium text-slate-900">{row.email}</td>
                <td>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${statusTone(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="tabular-nums">
                  {row.violation_count > 0
                    ? <span className="font-semibold text-orange-700">{row.violation_count}</span>
                    : <span className="text-slate-400">0</span>}
                </td>
                <td className="tabular-nums text-slate-600">{row.ai_score ?? '—'}</td>
                <td className="tabular-nums font-semibold text-slate-900">{row.trainer_score ?? '—'}</td>
                <td>
                  <button className="btn btn-secondary text-xs" onClick={() => openReview(row)}>
                    Xem &amp; chấm
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reviewing && (
        <div className="modal-backdrop" onClick={() => setReviewing(null)}>
          <div
            className="modal-card max-w-4xl text-left"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{reviewing.email}</h2>
              <button className="btn btn-secondary" onClick={() => setReviewing(null)}>Đóng</button>
            </div>

            <h3 className="mb-1 text-sm font-semibold text-slate-700">Bài làm</h3>
            <pre className="mb-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-100">
              {reviewing.answer || '(học viên chưa nộp bài)'}
            </pre>

            {reviewing.ai_feedback && (
              <>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">
                  Nhận xét của AI {reviewing.ai_score != null && `(${reviewing.ai_score} điểm)`}
                </h3>
                <p className="mb-4 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  {reviewing.ai_feedback}
                </p>
              </>
            )}

            <div className="form-grid">
              <label className="field">
                <span>Điểm giảng viên</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={score}
                  onChange={(event) => setScore(event.target.value)}
                />
              </label>
            </div>
            <label className="field field-wide mt-3">
              <span>Nhận xét của giảng viên</span>
              <textarea rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
            </label>

            <div className="form-footer">
              <p>Điểm của giảng viên ghi đè điểm AI khi xuất Excel.</p>
              <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Đang lưu…' : 'Lưu điểm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PracticeResultsTable;
