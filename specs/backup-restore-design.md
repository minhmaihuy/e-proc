# Backup and Restore

## Problem

Sao lưu hiện không tồn tại theo đúng nghĩa. `terraform-ipv6/rds.tf` đặt cùng lúc bốn
tham số phá huỷ khả năng phục hồi:

```hcl
backup_retention_period = 0      # không snapshot tự động, không point-in-time recovery
multi_az                = false
deletion_protection     = false
skip_final_snapshot     = true   # xoá DB không để lại snapshot nào
```

Một lần `terraform destroy` nhầm, một lần `apply` thay RDS, hoặc một sự cố AZ là mất
toàn bộ câu hỏi, bài làm, kết quả và bằng chứng gian lận, không có đường lấy lại.

Đường sao lưu duy nhất là cron `backup-db.sh` hằng đêm lên S3, và script đó hỏng theo
hai cách độc lập cho tới 2026-08-12: `grep DATABASE_URL` không neo `^` nên khớp luôn
`CONTROL_DATABASE_URL`, `LOG_DATABASE_URL`, `DATABASE_MAINTENANCE_DB` và sinh
`PGPASSWORD` rác; đồng thời mật khẩu trong URL đã `urlencode()` nên gán thẳng vào
`PGPASSWORD` là sai nguyên bản. Cả hai đã sửa, nhưng **chưa từng có bản khôi phục nào
được kiểm chứng**.

Không có script khôi phục. Không có giám sát khi backup thất bại.

## Requirements

1. RDS phải bật `backup_retention_period` (mặc định 14 ngày), `deletion_protection = true`,
   `skip_final_snapshot = false` kèm `final_snapshot_identifier`.
2. `tenants.backup_retention_days` (control-plane, mặc định 14) là cấu hình per-tenant do
   superadmin đặt, gắn với gói cước. Backup **luôn bật**, không có đường tắt — không có
   lý do kinh doanh nào để một tenant không có sao lưu.
3. Migration backfill 14 cho mọi tenant đang có; không được hạ số ngày của tenant nào khi
   nâng cấp.
4. Phải có `scripts/restore-db.sh` với hai ràng buộc bắt buộc:
   - luôn khôi phục sang **database mới**, không bao giờ ghi đè tại chỗ;
   - đổi `sslmode=no-verify` thành `require` trước khi gọi `psql`/`pg_dump`, vì
     `no-verify` là quy ước của node-postgres và libpq từ chối nó.
5. Phải có kiểm tra khôi phục tự động định kỳ (đề xuất hằng tháng): restore bản dump mới
   nhất sang database tạm, đối chiếu số dòng của `question_bank`, `students`,
   `exam_questions`, `violation_events` với nguồn, rồi xoá database tạm.
6. Thất bại của backup và của kiểm tra khôi phục phải ghi vào log-plane
   (`tenant_issue_logs`) — hạ tầng đã có, superadmin đã đọc được qua
   `GET /api/tenants/:id/issues`. Không dựng kênh giám sát mới.
7. `/tenants` hiển thị theo từng tenant: thời điểm backup gần nhất, dung lượng, thời điểm
   kiểm tra khôi phục gần nhất và kết quả.
8. Script không được in hay ghi log giá trị `DATABASE_URL`, mật khẩu, hay bất kỳ phần nào
   của chuỗi kết nối.

## Open decisions

- Số ngày lưu mặc định cho gói cơ bản so với gói doanh nghiệp (đề xuất 7 / 35).
- Có bật `multi_az` không. Tăng gấp đôi chi phí RDS nhưng là điều kiện để cam kết SLA.

## Verification

- `terraform validate` và `terraform plan` cho thấy RDS được sửa **tại chỗ**, không thay thế.
- Chạy `scripts/restore-db.sh` thật một lần vào database tạm và đối chiếu số dòng.
- Giả lập backup thất bại (đổi tên bucket) và xác nhận có dòng mới trong `tenant_issue_logs`.
- `npm run test:tenant` xanh, gồm test thuần cho phần chọn số ngày lưu.
- Kiểm tra `git grep` không thấy chuỗi kết nối nào bị in ra trong script.
