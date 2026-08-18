# Practice Exam Mode

## Problem

Practice là chế độ thi thứ hai: một đề `.docx` duy nhất cho cả đợt thi, học viên nộp một
bài trả lời holistic, không đi qua ngân hàng câu hỏi hay blueprint.

Tính năng này bị merge `ed8b5aa` xóa trắng, rồi được khôi phục — nhưng **khôi phục thiếu**.
Backend đủ (import, list, delete, kết quả, xuất Excel, chấm; ba route phía học viên),
`PracticeManagement.tsx` và `StudentPractice.tsx` cũng đủ. Nhưng ba điểm tích hợp chưa bao
giờ được nối lại; `git log -S practice_exam_id` trên `BatchManagement.tsx` và `Results.tsx`
đều trả về rỗng:

- không có mục nào trong `AdminNav`, nên `/admin/practice` chỉ tới được bằng cách gõ URL;
- không có cách gắn đề vào một đợt thi;
- không có màn hình chấm.

Hậu quả: import được đề nhưng **không học viên nào từng nhận được bài practice**. Không ai
phát hiện vì mọi mảnh riêng lẻ đều tồn tại và build vẫn xanh. Tệ hơn, `AGENTS.md` mô tả
tab Practice và nhánh practice ở Results như đã có — agent đọc tài liệu sẽ tin là xong.

## Requirements

1. Một đợt thi hoặc dùng blueprint, hoặc dùng đề Practice — **không bao giờ cả hai**.
   Backend phân biệt bằng `batches.practice_exam_id` có giá trị hay không; blueprint được
   lưu NULL cho đợt thi Practice.
2. `BatchManagement.tsx` phải có công tắc chọn nguồn (`batch/BatchSourceToggle.tsx`). Chế
   độ Practice thay **toàn bộ** khối blueprint bằng `batch/PracticeExamSelect.tsx` và gửi
   `practice_exam_id` thay `blueprint`.
3. Đợt thi Practice **bỏ qua hoàn toàn** thẩm định blueprint (tổng số câu, số câu có sẵn
   theo module/độ khó). Đề `.docx` là một bài duy nhất, không có gì để phân bổ.
4. Sau khi tạo đợt thi Practice vẫn mở form mời học viên, giống nhánh ngân hàng câu hỏi:
   đợt thi chưa có học viên thì chưa dùng được.
5. Khi chưa có đề nào, ô chọn đề phải nói rõ phải làm gì và trỏ tới `/admin/practice`,
   thay vì hiện một dropdown rỗng khiến người dùng tưởng tính năng hỏng.
6. `Results.tsx` phải nhận biết đợt thi Practice và hiện bảng một dòng mỗi học viên
   (email, trạng thái, số vi phạm, điểm AI, điểm giảng viên) kèm panel xem bài làm và chấm
   đè. Không dùng khung xem theo từng câu hỏi — đợt thi này không có nhiều câu.
7. Nút Export Excel phải trỏ đúng endpoint theo loại đợt thi. Hai định dạng khác nhau:
   practice là một sheet, mỗi học viên một dòng; đợt thường là mỗi học viên một sheet, mỗi
   câu một dòng.
8. `AdminNav` phải có mục cho mọi trang tenant đang tồn tại. Một trang không có lối vào
   trong menu coi như không tồn tại — đó chính là điều đã xảy ra với `/admin/practice` và
   `/admin/issues`.
9. `POST /student/verify` trả `exam_kind` để `StudentConfirm.tsx` điều hướng sang
   `/practice` hay `/exam`. Giá trị này dẫn xuất phía server từ `batches.practice_exam_id`,
   client không gửi lên.
10. `StudentPractice.tsx` là bản nhân bản có chủ đích của `StudentExam.tsx` về logic chống
    gian lận. Mọi thay đổi hành vi chống gian lận phải áp dụng cho **cả hai file**.
11. Xóa một đề Practice phải bị chặn khi còn đợt thi tham chiếu tới nó.
12. Nếu một token Practice đi nhầm vào `GET /student/exam/questions` hoặc
    `POST /student/exam/start` (tab cũ, bookmark, bundle cache cũ), backend phải trả
    `{ redirect: 'practice' }` trước khi sinh câu hỏi hay đổi trạng thái. Frontend phải
    xử lý redirect ở cả bước kiểm tra ban đầu, bước start và lần tải câu hỏi sau start;
    payload rỗng/không hợp lệ không được giữ spinner vô hạn.
13. Luồng đề thường phải bảo toàn danh tính kép `(id, question_group)` từ lúc chọn câu,
    ghi `exam_questions`, cho tới lúc `GET /student/exam/questions` join trả câu hỏi.
    `questions_count` báo thành công phải khớp số câu thực tế có thể tải lại và đúng group
    trong blueprint. Khi resume, các assignment cũ hoàn toàn không đọc được và chưa có câu
    trả lời được phép sinh lại nhưng phải giữ nguyên deadline/trạng thái recording; dữ liệu
    hỏng một phần hoặc đã có câu trả lời phải fail closed thay vì bị xóa. Group rỗng tường
    minh `question_group: ''` là một group hợp lệ; chỉ blueprint cũ thiếu property mới được
    match module trên mọi group.

## Verification

- `npm run test:tenant` xanh, gồm test đọc source khẳng định `BatchManagement.tsx` có
  `BatchSourceToggle`, `PracticeExamSelect` và `practice_exam_id`; `Results.tsx` có
  `isPracticeBatch`, `PracticeResultsTable`, `exportPracticeResults`; `AdminNav` có mục
  `/admin/practice` và `/admin/issues`.
- Chạy thật một lượt đầu-cuối: import `.docx` → tạo đợt thi Practice → mời học viên →
  học viên đăng nhập bằng mã truy cập và được đưa tới `/practice` → nộp bài → giảng viên
  chấm → xuất Excel. Đây là bước duy nhất chứng minh ba điểm tích hợp thực sự nối với nhau;
  type-check và test đọc source không thay thế được.
- Với cùng token Practice, gọi trực tiếp cả `/student/exam/questions` và
  `/student/exam/start`: cả hai phải trả redirect, không đổi status và
  `/student/practice` vẫn trả nội dung. Kiểm tra UI xử lý redirect từ GET lẫn POST.
- Tạo một đợt thi thường trong cùng phiên và xác nhận luồng cũ không đổi.
- Tạo đề thường có hai bộ dùng trùng `id`, start một học viên pending và khẳng định số
  câu trả về sau start bằng `questions_count`, đúng từng `question_group` đã chọn.
- Cho một học viên `in_progress` assignment cũ có group rỗng nhưng chưa trả lời, gọi start
  lại và xác nhận đề được sửa trong khi deadline không đổi; assignment hỏng một phần/đã trả
  lời phải bị từ chối và giữ nguyên dữ liệu.
- `npx tsc --noEmit` cả hai phía, `cd client && npm test`, build production và xác nhận số
  chunk không giảm (tách file không được làm vỡ code-splitting).
