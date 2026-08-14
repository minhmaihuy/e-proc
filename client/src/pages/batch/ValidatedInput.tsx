/**
 * Ô nhập số câu kèm cảnh báo vượt quá số có sẵn.
 *
 * PHẢI nằm ở phạm vi module, không được định nghĩa lại bên trong render của trang cha.
 * Mỗi lần cha render, một hàm mới được tạo ra và React coi đó là một KIỂU component
 * khác, nên nó unmount cả cây con rồi mount lại: ô nhập bị hủy khỏi DOM sau MỖI ký tự
 * và mất focus, admin phải bấm lại chuột để gõ tiếp. Lỗi này đã tái phát một lần.
 */
interface ValidatedInputProps {
  value: number;
  max: number;
  onChange: (value: string) => void;
}

function ValidatedInput({ value, max, onChange }: ValidatedInputProps) {
  const exceeded = value > max;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-[70px] rounded-md px-2 py-1.5 text-center outline-none ${
          exceeded
            ? 'border-2 border-red-500 bg-red-50 font-bold text-red-700'
            : 'border border-slate-300 bg-white font-normal text-slate-900'
        }`}
      />
      {exceeded && (
        <span className="whitespace-nowrap text-[10px] text-red-500">
          ⚠️ Max: {max}
        </span>
      )}
    </div>
  );
}

export default ValidatedInput;
