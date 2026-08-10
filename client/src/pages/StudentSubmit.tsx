import { useEffect, useState } from 'react';
import { CheckCircle2, FolderGit2 } from 'lucide-react';

function StudentSubmit() {
  // Phải đọc TRƯỚC khi localStorage.clear() chạy trong effect bên dưới, nếu không
  // hướng dẫn nộp video sẽ không bao giờ hiện. useState initializer chạy lúc render
  // đầu tiên, tức là trước effect.
  const [recordMode] = useState<string>(() => localStorage.getItem('recordMode') || 'none');

  useEffect(() => {
    localStorage.clear();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden text-center p-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-50 text-emerald-500 mb-6">
          <CheckCircle2 size={40} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-3">Assessment Submitted</h2>
        <p className="text-slate-600 mb-4 leading-relaxed">
          Your answers have been securely recorded. The evaluation system is processing your responses.
        </p>

        {/* Chế độ ghi cục bộ: video nằm trên máy học viên, hệ thống KHÔNG tự thu về được.
            Không nói rõ các bước ở đây thì bằng chứng chống gian lận coi như mất. */}
        {recordMode === 'local' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-6 text-left">
            <p className="flex items-center gap-2 font-semibold text-amber-900 mb-2">
              <FolderGit2 size={18} /> Còn một bước bắt buộc
            </p>
            <p className="text-amber-900 text-sm leading-relaxed mb-2">
              Bài thi này ghi màn hình vào thư mục bạn đã chọn trên máy. Bạn phải nộp thư mục đó
              lên repository của mình thì giám khảo mới xem được:
            </p>
            <ol className="text-amber-900 text-sm leading-relaxed list-decimal pl-5 space-y-1">
              <li>Mở thư mục đã chọn lúc bắt đầu thi, kiểm tra có các file <code>exam_*_part*.zip</code>.</li>
              <li>Copy toàn bộ file <code>.zip</code> vào repository bài nộp.</li>
              <li>
                Chạy:{' '}
                <code className="bg-amber-100 px-1 rounded">
                  git add . &amp;&amp; git commit -m "exam recording" &amp;&amp; git push
                </code>
              </li>
              <li>Báo lại giám thị khi đã push xong.</li>
            </ol>
            <p className="text-amber-800 text-xs leading-relaxed mt-3">
              Các file zip đã được mã hóa — bạn không cần và không có mật khẩu; giám khảo giữ mật
              khẩu để mở khi cần đối chiếu.
            </p>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mt-6">
          <p className="text-slate-500 text-sm leading-relaxed">
            Results will be available shortly. You may close this window and wait for further instructions from your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}

export default StudentSubmit;
