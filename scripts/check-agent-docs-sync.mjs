/**
 * Bảo đảm CLAUDE.md (Claude Code) và AGENTS.md (Codex) không bị lệch nội dung.
 *
 * Hai file cố ý khác nhau ở phần đầu — tiêu đề và mục "Maintenance contract" nói với
 * hai model khác nhau. Nhưng TOÀN BỘ kiến thức dự án nằm từ "## Commands" trở xuống
 * phải giống hệt nhau từng byte. Cập nhật một file mà quên file kia là kiểu lỗi âm
 * thầm: model còn lại vẫn chạy với thông tin cũ và không ai biết cho tới khi hỏng việc.
 *
 * Chạy: npm run docs:check
 * Chỉ ĐỌC, không sửa file nào.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHARED_BODY_MARKER = '## Commands';
export const DOC_FILES = Object.freeze(['CLAUDE.md', 'AGENTS.md']);

export class AgentDocsSyncError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentDocsSyncError';
  }
}

/** Cắt lấy phần thân dùng chung (từ marker tới hết file). */
export function extractSharedBody(content, label = 'document') {
  const index = content.indexOf(SHARED_BODY_MARKER);
  if (index === -1) {
    throw new AgentDocsSyncError(`${label}: không tìm thấy mốc "${SHARED_BODY_MARKER}".`);
  }
  // Chuẩn hóa xuống dòng để khác biệt CRLF/LF của Windows không bị báo nhầm là lệch.
  return content.slice(index).replace(/\r\n/g, '\n');
}

/** So sánh hai thân nội dung, trả về mô tả chỗ lệch đầu tiên (null nếu khớp). */
export function diffSharedBodies(bodyA, bodyB, labelA = 'CLAUDE.md', labelB = 'AGENTS.md') {
  if (bodyA === bodyB) return null;

  const linesA = bodyA.split('\n');
  const linesB = bodyB.split('\n');
  const max = Math.max(linesA.length, linesB.length);

  for (let i = 0; i < max; i += 1) {
    if (linesA[i] !== linesB[i]) {
      const shorten = (value) =>
        value === undefined ? '(hết file)' : value.length > 110 ? `${value.slice(0, 110)}…` : value;
      return {
        line: i + 1,
        message:
          `Thân nội dung lệch nhau ở dòng ${i + 1} (tính từ "${SHARED_BODY_MARKER}").\n` +
          `  ${labelA}: ${shorten(linesA[i])}\n` +
          `  ${labelB}: ${shorten(linesB[i])}`,
      };
    }
  }
  return { line: max, message: 'Thân nội dung lệch nhau về độ dài.' };
}

export function checkAgentDocsSync(readFile = (name) => readFileSync(path.join(REPO_ROOT, name), 'utf8')) {
  const [labelA, labelB] = DOC_FILES;
  const bodyA = extractSharedBody(readFile(labelA), labelA);
  const bodyB = extractSharedBody(readFile(labelB), labelB);
  const difference = diffSharedBodies(bodyA, bodyB, labelA, labelB);
  if (difference) {
    throw new AgentDocsSyncError(
      `${difference.message}\n\n` +
        `Sửa kiến thức dự án ở một file thì phải chép sang file kia trong cùng một thay đổi.\n` +
        `Chỉ tiêu đề và mục "Maintenance contract" được phép khác nhau.`,
    );
  }
  return { sharedLines: bodyA.split('\n').length };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const { sharedLines } = checkAgentDocsSync();
    console.log(`[docs:check] CLAUDE.md và AGENTS.md khớp nhau (${sharedLines} dòng thân chung).`);
  } catch (error) {
    console.error(`[docs:check] ${error.message}`);
    process.exitCode = 1;
  }
}
