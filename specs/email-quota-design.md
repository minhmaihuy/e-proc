# Email Delivery and Usage Quota

## Problem

**Không có email.** Không `nodemailer`, không SES, không SendGrid trong toàn bộ `src/` và
`package.json`. Hiện phát mã truy cập bằng cách export Excel rồi gửi tay. Đây vừa là
khoảng trống sản phẩm, vừa là nút thắt vận hành khi số kỳ thi tăng.

**Không có đo lượng dùng.** Không một dòng nào về `billing|subscription|quota`. Không đo
được số bài thi, số lần chấm AI, số phút ghi hình thì không định giá được và không chặn
được tenant dùng vượt.

## Requirements — Email

1. `tenants.email_enabled` (`BOOLEAN`, mặc định `false`), `tenants.email_from_name`,
   `tenants.email_daily_limit` (`INT`, mặc định 200). Chỉ superadmin bật.
2. Mặc định tắt là bắt buộc, không phải thận trọng thừa: mọi tenant gửi chung qua SES của
   nền tảng, nên một tenant nhập danh sách rác làm hỏng **uy tín gửi thư của toàn hệ
   thống** và đẩy thư của mọi khách hàng khác vào spam.
3. Nhà cung cấp là AWS SES. Cấu hình qua biến môi trường như S3; thiếu cấu hình thì API
   trả `503`, không làm sập luồng khác.
4. Hàng đợi `email_queue` ở data-plane, xử lý bằng đúng tick `QUEUE_PROCESS_INTERVAL` đã
   có trong `cache.ts`. **Không gửi đồng bộ trong request** — SES chậm hoặc lỗi sẽ treo API.
5. Bốn mẫu thư: mời thi kèm mã truy cập, nhắc trước giờ thi, báo kết quả, báo từ chối xác
   thực danh tính.
6. Bắt buộc xử lý bounce và complaint qua SNS. Thiếu nó thì SES hạ giới hạn gửi và không
   ai biết vì sao.
7. Thư không được chứa dữ liệu nhạy cảm ngoài mã truy cập; không đính kèm bài làm, không
   đính kèm ảnh giấy tờ.

## Requirements — Quota

8. Bảng `tenant_usage` ở control-plane: `(tenant_id, period_month, exams_started,
   ai_gradings, recording_minutes, emails_sent, code_runs)`.
9. Giới hạn trên `tenants`: `quota_exams_per_month`, `quota_ai_gradings_per_month`,
   `quota_recording_gb`, `quota_emails_per_month`. `NULL` nghĩa là không giới hạn, dành
   cho gói doanh nghiệp.
10. **Không bao giờ chặn một bài thi đang diễn ra.** Chặn chỉ ở hai điểm: lúc *tạo đợt
    thi* và lúc *bắt đầu bài thi*. Sau khi học viên đã vào phòng thi thì mọi hạn mức bị bỏ
    qua — hết quota giữa chừng mà cắt bài làm của thí sinh là thiệt hại không sửa được và
    là lý do khách hàng rời đi ngay lập tức. Vượt thì cho chạy tiếp, tính vào hoá đơn, cảnh
    báo superadmin.
11. Cảnh báo mềm ở 80%, chặn cứng ở 100% với thông báo nói rõ vượt hạn mức nào và liên hệ ai.
12. Ghi nhận lượng dùng phải idempotent theo sự kiện: một bài thi bắt đầu lại sau khi tải
    lại trang không được đếm hai lần.
13. Logic thuần ở `src/server/services/quotaPolicy.ts`, test không cần database.
14. Superadmin xem và sửa hạn mức tại `/tenants`, kèm biểu đồ lượng dùng so với giới hạn.

## Open decisions

- Vượt hạn mức thì chặn tenant hay cho chạy tiếp và tính thêm tiền. Quyết định này định
  hình toàn bộ logic ở requirement 10–11.
- Giá trị hạn mức mặc định cho từng gói cước.
- Có tính `code_runs` vào hạn mức không, hay chỉ theo dõi.

## Verification

- `npm run test:tenant` xanh, gồm `quotaPolicy.test.ts` thuần: `NULL` là không giới hạn;
  80% cảnh báo; 100% chặn ở tạo đợt thi nhưng **không** chặn bài thi đang chạy; ghi nhận
  hai lần cùng một sự kiện chỉ đếm một.
- Gửi thư thật trong môi trường thử, xác nhận bounce đi vào SNS và được ghi nhận.
- Tenant có `email_enabled = false` gọi API gửi thư phải nhận `403`.
- Bắt đầu một bài thi khi tenant đã vượt 100% hạn mức: bài thi **vẫn chạy tới khi nộp**.
- `npx tsc --noEmit` cả hai phía, build production.
