/**
 * Kiểu dữ liệu dùng chung cho màn hình quản lý đợt thi.
 *
 * Tách khỏi BatchManagement.tsx để trang đó chỉ còn phần điều phối, và để các
 * component con nhập kiểu mà không kéo theo cả trang 1800 dòng.
 */

export const BATCH_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export type BatchPageSize = typeof BATCH_PAGE_SIZE_OPTIONS[number];

/** Nguồn câu hỏi của một đợt thi. `practice` dùng đề .docx thay cho blueprint. */
export type BatchSource = 'question_bank' | 'practice';

export type BlueprintMode = 'module' | 'type';

export const QUESTION_TYPES = ['Coding', 'Conceptual', 'Fill-in', 'Debug'] as const;
export type QuestionType = typeof QUESTION_TYPES[number];

export interface BlueprintItem {
  /**
   * Khóa React ổn định, CHỈ tồn tại phía client. Các bảng blueprint xóa dòng theo
   * index, nên nếu key cũng là index thì sau khi xóa dòng giữa React sẽ gán state DOM
   * của dòng bị xóa cho dòng kế tiếp. Bị strip trước khi gửi lên server.
   */
  rowId?: string;
  module: string;
  /** Bộ đề: thiếu trường này thì đề sẽ trộn câu từ mọi bộ có cùng tên module. */
  question_group?: string;
  easy: number;
  medium: number;
  hard: number;
}

export interface BlueprintItemByType {
  rowId?: string;
  module: string;
  question_group?: string;
  type: QuestionType;
  easy: number;
  medium: number;
  hard: number;
}

export interface ModuleStats {
  module: string;
  easy: number;
  medium: number;
  hard: number;
}

export interface TypeStats {
  type: string;
  easy: number;
  medium: number;
  hard: number;
}

export interface ModuleTypeStats {
  module: string;
  type: string;
  easy: number;
  medium: number;
  hard: number;
}

export interface ModuleGroupOption {
  module: string;
  question_group: string;
}

export interface ModuleGroupStats extends ModuleGroupOption {
  easy: number;
  medium: number;
  hard: number;
}

export interface ModuleGroupTypeStats extends ModuleGroupStats {
  type: string;
}

/** Đề practice nhập từ .docx, dùng khi đợt thi ở chế độ Practice. */
export interface PracticeExamOption {
  id: number;
  name: string;
  created_at: string;
  batches_count: number;
}
