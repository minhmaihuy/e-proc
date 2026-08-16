# Client Design System and Component Layout

## Problem

Hai lớp hỏng im lặng cùng tồn tại trong frontend, và không cổng kiểm tra nào bắt được vì
TypeScript không kiểm chuỗi `className`, Vite vẫn build xanh, console không cảnh báo gì.

**53 class không có một dòng CSS nào.** Phát hiện bằng cách dựng thẻ mang từng class
trong trình duyệt rồi so kiểu tính toán với thẻ trắng — giống hệt nhau, tức class hoàn
toàn trơ. `UserManagement`, `TenantManagement`, `SecretsPanel` và `StudentPractice` dựng
gần như toàn bộ bố cục trên bộ từ vựng này, nên các trang đó đổ về dòng chảy mặc định:
modal mất lớp phủ **và** mất định vị nên trôi theo trang trong khi nền sau vẫn bấm được;
badge trạng thái thành chữ trơn; lưới biểu mẫu thành chồng dọc; nút `btn-ghost` và
`btn-danger-outline` chỉ nhận phần nền của `.btn` (vốn `border-transparent`, không màu
nền) nên hiện ra như chữ, người dùng không nhận ra là nút.

**Component định nghĩa bên trong render.** `BatchManagement.tsx` định nghĩa lại
`ValidatedInput`, `BlueprintModeToggle` và hai panel thống kê trong mỗi lần render cha.
React coi mỗi lần render là một KIỂU component khác nên unmount cả cây con: ô nhập số câu
bị hủy khỏi DOM sau MỖI ký tự và mất focus. Lỗi này từng được sửa, rồi **tái phát** — vì
test hồi quy cũ chỉ dựng component tự chế để tái hiện nguyên lý React, không hề đọc file
thật.

## Requirements

1. Mọi class thuộc bộ từ vựng riêng của dự án dùng trong TSX phải có định nghĩa trong
   `client/src/styles/global.css`, đặt trong `@layer components` để utility Tailwind viết
   tại chỗ vẫn ghi đè được.
2. Các họ class trạng thái sinh động (`status-*`, `provision-*`, `job-*`) phải có màu cho
   mọi giá trị backend thực sự sinh ra. Thiếu thì badge im lặng rơi về xám trung tính và
   mọi trạng thái trông giống hệt nhau.
3. Ba nhóm tiền tố trạng thái dùng chung một bảng màu vì cùng ngữ nghĩa chờ / đang chạy /
   xong / hỏng, và thường đứng cạnh nhau trên cùng màn hình.
4. Chấm trạng thái (`status-dot`) dùng nền đặc riêng, không tái dùng lớp nhạt của badge —
   chấm không có chữ nên nền nhạt gần như vô hình.
5. Component chỉ phục vụ MỘT trang đặt trong thư mục cùng tên trang
   (`pages/batch/**`, `pages/results/**`, `pages/questionBank/**`, `pages/tenant/**`).
   Component dùng chung nhiều trang mới đặt ở `components/`.
6. Kiểu dữ liệu và hàm thuần của trang tách thành `types.ts` / `helpers.ts` trong cùng thư
   mục — hàm thuần tách ra thì test được mà không cần dựng React.
7. Component con nhận dữ liệu qua **props**, không đọc state của cha. Đây là điều kiện để
   component nằm được ở phạm vi module thay vì bị định nghĩa lại trong render.
8. **Không component nào được định nghĩa bên trong render của component khác.** Ngoại lệ
   duy nhất là component chính của file bị thụt lề hợp lệ do bọc trong `forwardRef`/`memo`.
9. Inline `style` chỉ được dùng khi giá trị không biểu diễn được bằng class tĩnh: vị trí
   tính theo chỉ số vòng lặp (watermark), màu lấy từ palette tính trong JS, hoặc lớp vỏ
   hiển thị khi stylesheet có thể chưa tải được (`ErrorBoundary`, `PrivateRoute`,
   `RouteFallback` dùng `var(--x, #hex)` có giá trị dự phòng cứng — đó là chủ ý, không
   phải sót).
10. `client/src/App.tsx` phải nằm trong danh sách `exclude` của obfuscator. Không thì
    Rollup không phân giải được specifier trong `import()`, **không sinh chunk nào**, build
    vẫn báo thành công và app 404 ở lần điều hướng đầu tiên.

## Verification

- `npm run test:tenant` xanh, gồm `scripts/clientDesignSystem.test.js`: mọi class riêng có
  định nghĩa; các class trạng thái động có màu; không file nào định nghĩa component trong
  render.
- Kiểm chứng test bắt lỗi thật: xóa thử một class khỏi `global.css` và chèn thử một
  component vào render của một trang, xác nhận suite đỏ ở đúng chỗ, rồi khôi phục.
- Build production và xác nhận **số chunk không giảm** — tách file hay đổi cấu hình
  obfuscator không được làm vỡ code-splitting.
- Với thay đổi thuần CSS, đo kiểu tính toán trực tiếp trong trình duyệt là bằng chứng hợp
  lệ; nhưng thay đổi bố cục phải xem bằng mắt ở cả bề rộng desktop và mobile.
