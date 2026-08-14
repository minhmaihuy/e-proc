import { useId } from 'react';
import { Link } from 'react-router-dom';
import { PracticeExamOption } from './types';

/**
 * Chọn đề Practice cho đợt thi.
 *
 * Thay cho toàn bộ khối blueprint khi đợt thi ở chế độ Practice: đề .docx là một bài
 * duy nhất cho mọi học viên nên không có gì để phân bổ theo module hay độ khó.
 */
interface PracticeExamSelectProps {
  practiceExams: PracticeExamOption[];
  value: number | null;
  onChange: (practiceExamId: number | null) => void;
  disabled?: boolean;
}

function PracticeExamSelect({ practiceExams, value, onChange, disabled = false }: PracticeExamSelectProps) {
  const fieldId = useId();

  if (practiceExams.length === 0) {
    // Không có đề nào thì nói thẳng phải làm gì, thay vì để một dropdown rỗng khiến
    // người dùng tưởng tính năng hỏng.
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="m-0 font-medium">Chưa có đề Practice nào.</p>
        <p className="m-0 mt-1">
          Nhập một file <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-xs">.docx</code> ở{' '}
          <Link to="/admin/practice" className="font-semibold underline underline-offset-2">
            Practice Exams
          </Link>{' '}
          trước khi tạo đợt thi ở chế độ này.
        </p>
      </div>
    );
  }

  return (
    <div className="form-group mb-0">
      <label htmlFor={fieldId}>Đề Practice</label>
      <select
        id={fieldId}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        required
      >
        <option value="">— Chọn đề —</option>
        {practiceExams.map((exam) => (
          <option key={exam.id} value={exam.id}>
            {exam.name}
          </option>
        ))}
      </select>
      <small className="mt-1.5 block text-slate-500">
        Mọi học viên trong đợt thi làm chung một đề, nộp một bài trả lời duy nhất.
      </small>
    </div>
  );
}

export default PracticeExamSelect;
