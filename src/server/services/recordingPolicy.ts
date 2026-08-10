/**
 * Chính sách ghi màn hình theo tenant.
 *
 * Có HAI tầng, đừng nhầm:
 *  - Tenant (control-plane, superadmin đặt): danh sách mode được PHÉP dùng.
 *  - Batch (data-plane, tenant_admin đặt): mode thực sự dùng cho đợt thi đó.
 *
 * Batch chỉ được chọn trong phạm vi tenant cho phép. Nhờ vậy một tenant có thể bị giới
 * hạn ở 'local' (không được đẩy video lên S3 của nền tảng) mà vẫn tự do quyết định đợt
 * thi thử thì không ghi, đợt thi thật thì ghi.
 *
 * Toàn bộ hàm ở đây là hàm thuần để test không cần database.
 */

export type RecordMode = 'none' | 'local' | 's3';

/** 'none' luôn được phép: không ghi màn hình thì không cần cấp quyền gì. */
export const ALL_RECORD_MODES: readonly RecordMode[] = ['none', 'local', 's3'];

export function isRecordMode(value: unknown): value is RecordMode {
  return typeof value === 'string' && (ALL_RECORD_MODES as readonly string[]).includes(value);
}

/**
 * Chuẩn hóa cấu hình tenant từ chuỗi lưu trong DB (vd "local,s3").
 * Luôn có 'none', luôn theo thứ tự none → local → s3, không trùng lặp.
 */
export function parseAllowedRecordModes(raw: unknown): RecordMode[] {
  const tokens = String(raw ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  const allowed = new Set<RecordMode>(['none']);
  for (const token of tokens) {
    if (isRecordMode(token)) allowed.add(token);
  }
  return ALL_RECORD_MODES.filter((mode) => allowed.has(mode));
}

/** Dạng chuẩn để ghi xuống cột DB. */
export function serializeAllowedRecordModes(modes: unknown): string {
  return parseAllowedRecordModes(Array.isArray(modes) ? modes.join(',') : modes).join(',');
}

export interface RecordModeDecision {
  mode: RecordMode;
  /** true khi yêu cầu của client bị từ chối và phải hạ về giá trị khác. */
  rejected: boolean;
  reason?: string;
}

/**
 * Quyết định mode cuối cùng cho một batch.
 *
 * Nguyên tắc: KHÔNG bao giờ âm thầm nâng cấp quyền. Yêu cầu nằm ngoài allowlist của
 * tenant sẽ bị hạ về `fallback` (mode đang lưu, hoặc 'none' khi tạo mới) chứ không
 * được chấp nhận. Frontend có ẩn lựa chọn hay không chỉ là UX; đây mới là chỗ chặn thật.
 */
export function resolveBatchRecordMode(params: {
  requested: unknown;
  allowedForTenant: RecordMode[];
  fallback?: RecordMode;
  /** Vai trò không được phép đổi thì luôn giữ nguyên fallback. */
  canChange: boolean;
}): RecordModeDecision {
  const fallback = params.fallback ?? 'none';

  if (!params.canChange) {
    return { mode: fallback, rejected: false };
  }
  if (!isRecordMode(params.requested)) {
    return { mode: fallback, rejected: false };
  }
  if (!params.allowedForTenant.includes(params.requested)) {
    return {
      mode: fallback,
      rejected: true,
      reason: `Tenant không được phép dùng chế độ ghi màn hình "${params.requested}".`,
    };
  }
  return { mode: params.requested, rejected: false };
}

/** Nhãn hiển thị dùng chung cho cả trang tenant lẫn trang tạo batch. */
export function recordModeLabel(mode: RecordMode): string {
  switch (mode) {
    case 'local':
      return 'Record Local (máy học viên, mã hóa)';
    case 's3':
      return 'Record S3 (tải lên AWS S3)';
    default:
      return 'Không ghi màn hình';
  }
}
