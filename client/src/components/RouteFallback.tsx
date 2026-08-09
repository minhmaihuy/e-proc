/**
 * Fallback trong lúc chunk của route đang tải (xem lazy() trong App.tsx).
 *
 * Cố ý giữ tối giản và không có animation nặng: nó nằm trong bundle khởi động, và
 * trên máy phòng thi thì mỗi KB đều tính. `aria-busy` + `role="status"` để trình đọc
 * màn hình thông báo trạng thái đang tải thay vì im lặng.
 */
function RouteFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        color: 'var(--text-light, #6b7280)',
        fontSize: 14,
      }}
    >
      Đang tải…
    </div>
  );
}

export default RouteFallback;
