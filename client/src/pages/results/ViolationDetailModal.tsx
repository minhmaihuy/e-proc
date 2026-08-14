import { AlertCircle, ShieldAlert, X } from 'lucide-react';

/**
 * Popup pháp chứng: từng lần vi phạm của một học viên, kèm 500 ký tự đầu của nội dung
 * đã dán.
 *
 * Đây là màn hình giám thị dùng để phân xử khi học viên khiếu nại, nên phải hiện đủ
 * dấu vết thô: loại vi phạm, thời điểm, độ dài văn bản, câu hỏi liên quan và nội dung
 * dán nguyên văn — không tóm tắt, không diễn giải.
 */
export interface ViolationEvent {
  type: string;
  created_at: string;
  text_length?: number | null;
  question_id?: string | null;
  content_preview?: string | null;
  metadata_json?: string | Record<string, unknown> | null;
}

interface ViolationDetailModalProps {
  email: string;
  events: ViolationEvent[];
  onClose: () => void;
}

/** metadata_json có thể là chuỗi JSON hoặc object tùy đường ghi; hỏng thì bỏ qua. */
function metadataSummary(raw: ViolationEvent['metadata_json']): string | null {
  if (!raw) return null;
  try {
    const metadata = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(' · ');
  } catch {
    return null;
  }
}

function ViolationDetailModal({ email, events, onClose }: ViolationDetailModalProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Violation details for ${email}`}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h3 className="m-0 flex items-center gap-2 border-none pb-0 font-bold text-slate-900">
            <AlertCircle size={20} className="text-red-500" />
            Violation Details
            <span className="ml-2 text-sm font-normal text-slate-500">{email}</span>
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-6">
          {events.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              <ShieldAlert size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No detailed records found.</p>
            </div>
          ) : (
            events.map((event, index) => {
              const metadata = metadataSummary(event.metadata_json);
              return (
                <div key={index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-orange-700">
                      <span className="h-2 w-2 rounded-full bg-orange-500" /> {event.type}
                    </span>
                    <span className="flex items-center gap-1 text-slate-500">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                    {event.text_length != null && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-slate-700">
                        {event.text_length} chars
                      </span>
                    )}
                    {event.question_id && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-blue-700">
                        Q: {event.question_id}
                      </span>
                    )}
                    {metadata && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 font-mono text-purple-700">
                        {metadata}
                      </span>
                    )}
                  </div>
                  {event.content_preview && (
                    <pre className="m-0 max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words bg-slate-900 p-4 font-mono text-xs text-slate-300">
                      {event.content_preview}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default ViolationDetailModal;
