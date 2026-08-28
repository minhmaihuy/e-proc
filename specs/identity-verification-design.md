# Candidate Identity Verification

## Problem

Hệ thống chống gian lận rất dày: chặn clipboard trong Monaco, phát hiện side-panel qua
`documentElement` width, `focus_lost` với grace 3 giây, `suspicious_paste` ngưỡng 300 ký
tự, `rapid_text_insertion`, watermark động, quay màn hình, và nhật ký `violation_events`
ghi từng sự kiện.

Nhưng xác thực học viên chỉ là **một mã truy cập 8 ký tự**. Không có gì chứng minh người
đang ngồi thi là người được mời. Thuê người thi hộ khiến toàn bộ lớp chống gian lận trên
trở nên vô nghĩa: người thi hộ không cần dán, không cần chuyển tab, họ chỉ đơn giản là
biết làm bài.

Đây là khoảng trống lớn nhất giữa hệ thống hiện tại và một sản phẩm proctoring bán được.

## Requirements

1. **Luồng đăng nhập bằng mã truy cập giữ nguyên tuyệt đối.** `POST /student/verify`
   không đổi hợp đồng đầu vào. Xác thực danh tính là một bước chèn thêm ở `/confirm`,
   chỉ xuất hiện khi tenant bật. Tenant không bật thì học viên không thấy khác gì hôm nay.
2. `tenants.identity_verification` (control-plane, `VARCHAR(16)`, mặc định `'off'`) nhận
   ba giá trị:
   - `off` — như hiện tại; là giá trị backfill cho mọi tenant đang có;
   - `photo` — chụp giấy tờ + ảnh mặt, giảng viên duyệt bằng mắt;
   - `face_match` — như trên, cộng so khớp tự động và lấy mẫu định kỳ trong lúc thi.
3. Logic thuần nằm ở `src/server/services/identityPolicy.ts`, test không cần database,
   cùng khuôn `recordingPolicy.ts`. Không bao giờ âm thầm nâng cấp mức: batch yêu cầu mức
   cao hơn mức tenant cho phép thì rơi về mức tenant, và route trả `403`.
4. Data-plane thêm vào `students`: `identity_status`
   (`not_required|pending|captured|verified|rejected`), `identity_id_key`,
   `identity_face_key`, `identity_score`, `identity_reviewed_by`, `identity_reviewed_at`.
5. `/student/verify` trả thêm `identity_mode`, dẫn xuất từ tenant ở phía server. Client
   không bao giờ gửi lên mức xác thực.
6. Ảnh tải lên bằng presigned PUT, nhân bản `createRecordingUploadUrl` thành
   `createIdentityUploadUrl` trong `services/s3.ts`. **S3 key dựng từ JWT**
   (`identity/{batchId}/{studentId}/…`), không nhận từ client, để một thí sinh không ghi
   đè được ảnh của người khác.
7. **Chốt phía server là thẩm quyền cuối**: `GET /exam/questions` và `GET /student/practice`
   trả `403` kèm `reason: 'identity_required'` khi tenant bật mà `identity_status` chưa
   đạt. Kiểm tra ở UI chỉ là trải nghiệm.
8. Giảng viên duyệt trên `Results.tsx`: hai ảnh cạnh nhau, nút duyệt/từ chối, dùng lại
   `createRecordingViewUrl` (presigned GET hạn 5 phút).
9. Với `face_match`: gọi so khớp sau khi chụp, lưu `identity_score`, tự gắn cờ dưới ngưỡng.
   Lấy mẫu trong lúc thi ghi violation `identity_mismatch` **chỉ để lưu vết, KHÔNG khoá
   bài thi tự động** — nhận diện khuôn mặt sai lệch vì ánh sáng hay góc máy là chuyện
   thường, khoá nhầm một thí sinh thật tệ hơn bỏ sót một trường hợp.
10. Ảnh giấy tờ là PII nhạy cảm nhất trong hệ thống, nặng hơn video màn hình. Bắt buộc:
    prefix S3 riêng với lifecycle ngắn hơn bản ghi màn hình; IAM chỉ `PutObject`/`GetObject`
    trên đúng prefix đó; không bao giờ trả S3 key thô về client; ghi `tenant.identity_viewed`
    vào `tenant_audit_events` mỗi lần admin xem.
11. Học viên phải được thông báo rõ trước khi chụp: thu thập cái gì, giữ bao lâu, ai xem
    được.

## Open decisions

- `face_match` có nằm trong phạm vi đợt này không. Ảnh hưởng tới chi phí biến đổi và tới
  nghĩa vụ pháp lý: nhiều nơi xếp dữ liệu sinh trắc học vào loại được bảo vệ đặc biệt.
- Ngưỡng điểm so khớp để gắn cờ, nếu làm `face_match`.

## Product decision — evidence retention (2026-08-13)

- Superadmin nhập cả `recording_retention_days` và `identity_retention_days` tại màn hình
  quản lý tenant. Không có giá trị mặc định ngầm cho dữ liệu bằng chứng mới.
- Khi tenant cho phép chế độ ghi màn hình `s3`, `recording_retention_days` là bắt buộc và
  phải là số nguyên 1–365. Khi tenant bật `photo`, cả hai thời hạn đều bắt buộc và
  `identity_retention_days < recording_retention_days`.
- Tenant cũ được backfill `recording_retention_days = NULL`; migration không tự chọn thời hạn
  hay thay đổi lifecycle đang vận hành. Superadmin có thể lưu draft chưa hoàn chỉnh, nhưng tenant
  phải cấu hình rõ trước lần approve/provision tiếp theo có bật S3/photo.
- Terraform quản lý bucket ghi màn hình riêng, private, mã hóa, CORS PUT giới hạn đúng origin,
  IAM chỉ trên `recordings/*`, và lifecycle theo `recording_retention_days`. Tắt S3/photo không
  xóa bucket đã có; thời hạn đã nhập được giữ lại để bằng chứng hiện hữu tiếp tục hết hạn.

## Implemented scope (2026-08-12)

- This change implements `photo` only. `face_match`, automated comparison, biometric scores, periodic sampling, and `identity_mismatch` remain deferred.
- Retention is configured explicitly in tenant management. Existing/new never-enabled tenants keep nullable retention values; enabling S3 recording requires `recording_retention_days` and enabling `photo` additionally requires an explicit shorter `identity_retention_days`. Disabling preserves selected lifecycle values so already-stored evidence expires without planning destructive bucket removal.

## Verification

- `npm run test:tenant` xanh, gồm `identityPolicy.test.ts` thuần: `off` không bao giờ chặn;
  không âm thầm nâng cấp mức; `captured` chưa đủ khi tenant yêu cầu `verified`.
- Thi thật ở tenant để `off`: luồng học viên không đổi một bước nào.
- Thi thật ở tenant để `photo`: bỏ qua bước chụp rồi gọi thẳng `GET /exam/questions` phải
  nhận `403 identity_required`.
- Xác nhận S3 key sinh từ JWT: sửa `studentId` trong request không đổi được key.
- `npx tsc --noEmit` cả hai phía, `cd client && npm test`, build production.
