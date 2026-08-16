# Tenant Roles and Access Control

## Problem

Mô hình vai trò chỉ tồn tại dưới dạng văn xuôi rải rác trong `AGENTS.md`, không có
requirement đánh số nào để harness đối chiếu. Hậu quả là ba lớp lỗi cùng tồn tại trên
production tới 2026-08-12, và không cổng kiểm tra nào bắt được:

1. **`POST /api/admin/setup` mở cho toàn internet.** Tài liệu tuyên bố endpoint này đã
   gỡ từ đợt hardening 2026-07; thực tế nó vẫn nằm trong `admin.ts`, PHÍA TRÊN
   `router.use(authMiddleware)`. Xác nhận trên máy thật: `is-initialized` trả
   `{"initialized":false}`, `setup` với body rỗng trả 400 — tức handler được chạy, không
   có lớp xác thực nào chặn. Bất kỳ ai cũng ghi được một hàng vào `admin_users` của
   database production.

2. **Toàn bộ CRUD `/users` thao tác nhầm database plane.** `admin.ts` import `db` từ
   `postgres.js` (data-plane khảo thí) trong khi tài khoản sống ở control-plane. Danh
   sách người dùng luôn rỗng; tài khoản tạo ra không đăng nhập được; và nguy hiểm nhất
   là **xóa báo thành công nhưng người đó vẫn đăng nhập bình thường**. `PUT /users/:id`
   còn không tồn tại dù client vẫn gọi, nên đổi vai trò và đặt lại mật khẩu đều nhận 404
   trong im lặng.

3. **Đảo ngược đặc quyền ở bốn chỗ.** Bốn kiểm tra viết `role !== 'admin'` để áp ràng
   buộc sở hữu. Nhưng `admin` là giáo viên/cộng tác viên còn `tenant_admin` mới là người
   quản lý, nên chúng giới hạn đúng người NHIỀU quyền hơn và thả cửa cho giáo viên.

Gốc rễ của cả ba là cái tên: `admin` nghe như vai trò cao nhất nhưng thực chất là người
dùng thường.

## Requirements

1. Ba vai trò, ranh giới cố định:
   - `superadmin` — toàn cục, `tenant_id` NULL, quản lý tenant và cấu hình hạ tầng.
     **Không** đọc/ghi dữ liệu khảo thí của tenant và **không** quản lý người dùng tenant.
   - `tenant_admin` — thuộc đúng một tenant, quản lý giáo viên/cộng tác viên, toàn quyền
     trên dữ liệu khảo thí của tenant mình.
   - `admin` — giáo viên/cộng tác viên, người dùng thường trong tenant.
2. Không route nào trong `admin.ts` được đặt phía trên `router.use(authMiddleware)`.
   Self-service registration (`/setup`, `/is-initialized`) không được tồn tại dưới bất kỳ
   hình thức nào.
3. Mọi truy vấn `admin_users` phải đi qua `controlPlane.ts`. Đi qua data-plane là lỗi
   im lặng nguy hiểm nhất trong nhóm này: thu hồi quyền thất bại mà giao diện báo thành công.
4. `/api/admin/users` phải đủ bốn động từ GET/POST/PUT/DELETE, tất cả sau
   `requireTenantUserManager`.
5. Vai trò hợp lệ khi tạo/sửa người dùng trong tenant chỉ gồm `tenant_admin` và `admin`.
   Không nhận vai trò của mô hình cũ (`mod`) — nó tạo ra tài khoản mà không guard nào
   nhận ra, tức tài khoản chết.
6. `tenant_id` khi tạo người dùng lấy từ JWT của người gọi, **không** lấy từ body: tin
   body cho phép một tenant_admin tạo tài khoản sang tenant khác.
7. Ràng buộc sở hữu (`uploaded_by`/`created_by`) áp lên `admin`, **không** áp lên
   `tenant_admin`. Viết `role !== 'admin'` là đảo ngược ý định.
8. Không được xóa hoặc hạ cấp `tenant_admin` cuối cùng của một tenant: `superadmin` cố ý
   không quản lý được người dùng tenant, nên mất người cuối là khóa tenant ra ngoài vĩnh
   viễn, không ai dựng lại được.
9. Không tự xóa chính mình, không tự đổi vai trò của mình, không tự đặt lại mật khẩu của
   mình qua user CRUD (đổi mật khẩu bản thân phải qua `/change-password`, nơi có bắt nhập
   mật khẩu hiện tại).
10. `tenant_admin` không được đụng tới `superadmin` hay người dùng của tenant khác —
    kiểm tra qua `canManageTenantUser` trong `tenantContext.ts`.
11. Không phân quyền theo tên đăng nhập ở bất kỳ đâu. Chỉ dựa trên `role` và `tenant_id`.
    Tên tài khoản seed mặc định chỉ được dùng làm giá trị khởi tạo, không bao giờ làm
    điều kiện cấp quyền.
12. Frontend (`PrivateRoute`, `AdminNav`, ẩn/hiện nút) chỉ là trải nghiệm. Backend
    middleware và điều kiện SQL theo tenant mới là ranh giới bảo mật. Thanh điều hướng
    `/admin/*` không được hiện ở chế độ superadmin — mọi mục trong đó đều trả 403.

## Verification

- `npm run test:tenant` xanh, gồm `adminUserRoutes.test.ts` đọc thẳng source: không route
  nào trên `authMiddleware`; không còn `/setup`; mọi truy vấn `admin_users` qua `controlDb`;
  đủ bốn động từ; đúng 4 chỗ ràng buộc sở hữu dạng `role === 'admin'`.
- Kiểm chứng test thật sự bắt lỗi: đảo một kiểm tra sở hữu về `role !== 'admin'`, xác nhận
  suite đỏ, rồi khôi phục. Test chỉ xanh mà chưa từng đỏ là test vô giá trị.
- Trên máy đã deploy, `POST /api/admin/setup` và `GET /api/admin/is-initialized` phải trả
  `401` (rơi vào authMiddleware) hoặc `404`, tuyệt đối không phải `400`.
- Đăng nhập bằng `tenant_admin`, xóa một tài khoản, rồi thử đăng nhập lại bằng tài khoản
  đó: phải bị từ chối. Đây là bước duy nhất chứng minh xóa chạm đúng plane.
