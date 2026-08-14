/**
 * Hàm thuần dùng chung cho màn hình quản lý đợt thi.
 *
 * Không phụ thuộc React nên test được trực tiếp, và tách ra khỏi trang để phần điều
 * phối không lẫn với chuyển đổi múi giờ hay mã hóa khóa dropdown.
 */

/** "YYYY-MM-DDTHH:mm" (hiểu là giờ GMT+7) → chuỗi ISO theo UTC. */
export function localToUTC(localStr: string): string {
  if (!localStr) return localStr;
  // Gắn +07:00 để trình duyệt hiểu đúng là giờ Việt Nam rồi mới quy về UTC.
  return new Date(`${localStr}:00+07:00`).toISOString();
}

/** Chuỗi ISO UTC → "YYYY-MM-DDTHH:mm" theo GMT+7, để đổ vào input datetime-local. */
export function utcToLocalInput(utcStr: string): string {
  if (!utcStr) return '';
  const date = new Date(utcStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return gmt7.toISOString().slice(0, 16);
}

/** Chuỗi ISO UTC → chuỗi hiển thị theo GMT+7 cho bảng danh sách. */
export function formatGMT7(utcStr: string): string {
  if (!utcStr) return '';
  return new Date(utcStr).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/** Id ổn định cho một dòng blueprint (chỉ dùng phía client, xem BlueprintItem.rowId). */
let rowIdCounter = 0;
export function newRowId(): string {
  return `row_${Date.now().toString(36)}_${rowIdCounter++}`;
}

/**
 * Một <option> chỉ mang được MỘT chuỗi, nhưng blueprint cần cả module lẫn bộ đề —
 * cùng tên module có thể tồn tại ở nhiều bộ và số câu có sẵn khác nhau. Nên mã hóa
 * cặp đó thành một khóa duy nhất cho dropdown.
 */
export function comboKey(module: string, group: string): string {
  return `${module}|||${group || ''}`;
}

export function decodeComboKey(key: string): { module: string; question_group: string } {
  const i = key.indexOf('|||');
  return i === -1
    ? { module: key, question_group: '' }
    : { module: key.slice(0, i), question_group: key.slice(i + 3) };
}

export function comboLabel(module: string, group: string): string {
  return group ? `${module} (${group})` : module;
}
