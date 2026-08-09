import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Chốt lại lỗi đã sửa ở BatchManagement: các component con (ValidatedInput,
 * ModuleGroupSelect, BlueprintModeToggle, hai panel thống kê) từng được định nghĩa
 * BÊN TRONG component cha. Mỗi lần cha render, JS tạo hàm mới → React coi đó là một
 * KIỂU component khác → unmount cây con rồi mount lại. Ô nhập số câu vì thế bị hủy
 * khỏi DOM sau MỖI ký tự và mất focus, admin phải click lại để gõ tiếp.
 *
 * Test này không import trang thật (1600 dòng, kéo theo axios/router/API) mà tái hiện
 * đúng cấu trúc gây lỗi, rồi khẳng định cách viết đúng giữ được focus. Nó bảo vệ bài
 * học, không phải chi tiết cài đặt — ai lỡ đưa component trở vào trong render sẽ thấy
 * bản "bên trong" đỏ ngay.
 */

// ✅ Cách đúng: kiểu component ổn định vì nằm ở module scope.
function ValidatedInput({ value, onChange }: { value: number; onChange: (v: string) => void }) {
  return (
    <input
      aria-label="số câu"
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function FormWithHoistedInput() {
  const [value, setValue] = useState(0);
  return <ValidatedInput value={value} onChange={(v) => setValue(Number(v) || 0)} />;
}

function FormWithInlineInput() {
  const [value, setValue] = useState(0);
  // ❌ Đúng kiểu code cũ: định nghĩa lại component trong mỗi lần render.
  const InlineInput = ({ value: v, onChange }: { value: number; onChange: (v: string) => void }) => (
    <input aria-label="số câu" type="number" value={v} onChange={(event) => onChange(event.target.value)} />
  );
  return <InlineInput value={value} onChange={(v) => setValue(Number(v) || 0)} />;
}

describe('component con của form blueprint', () => {
  it('giữ nguyên node DOM và focus khi gõ (cách đúng)', async () => {
    render(<FormWithHoistedInput />);
    const input = screen.getByLabelText('số câu');
    input.focus();

    await userEvent.type(input, '12');

    expect(screen.getByLabelText('số câu')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('12');
  });

  it('tái hiện lỗi cũ: định nghĩa trong render làm input bị thay node và mất focus', async () => {
    render(<FormWithInlineInput />);
    const input = screen.getByLabelText('số câu');
    input.focus();

    await userEvent.type(input, '1');

    // React đã dựng lại một input khác; node cũ rời khỏi DOM nên focus cũng mất.
    expect(input.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });
});
