import { BatchSource } from './types';

/**
 * Chọn nguồn câu hỏi của đợt thi.
 *
 * Một đợt thi hoặc lấy câu từ ngân hàng theo blueprint, hoặc dùng một đề Practice
 * nhập từ .docx — không bao giờ cả hai. Backend phân biệt bằng `batches.practice_exam_id`
 * có giá trị hay không, nên hai chế độ phải loại trừ nhau ngay ở giao diện.
 */
interface BatchSourceToggleProps {
  value: BatchSource;
  onChange: (source: BatchSource) => void;
  disabled?: boolean;
}

const OPTIONS: { value: BatchSource; label: string; hint: string }[] = [
  { value: 'question_bank', label: '🗂 Question Bank', hint: 'Sinh đề theo blueprint' },
  { value: 'practice', label: '📄 Practice', hint: 'Dùng đề .docx đã nhập' },
];

function BatchSourceToggle({ value, onChange, disabled = false }: BatchSourceToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Nguồn câu hỏi"
      className="mb-4 flex w-fit overflow-hidden rounded-lg border-[1.5px] border-emerald-500"
    >
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`cursor-pointer border-none px-[22px] py-[7px] text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default BatchSourceToggle;
