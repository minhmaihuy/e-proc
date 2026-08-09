import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentDocsSyncError,
  DOC_FILES,
  checkAgentDocsSync,
  diffSharedBodies,
  extractSharedBody,
} from './check-agent-docs-sync.mjs';

test('CLAUDE.md và AGENTS.md đang khớp nhau', () => {
  const { sharedLines } = checkAgentDocsSync();
  assert.ok(sharedLines > 100, 'thân chung phải chứa toàn bộ kiến thức dự án');
});

test('cả hai file đều được kiểm tra', () => {
  assert.deepEqual([...DOC_FILES], ['CLAUDE.md', 'AGENTS.md']);
});

test('phần đầu khác nhau không bị coi là lệch', () => {
  const readFile = (name) =>
    name === 'CLAUDE.md'
      ? '# CLAUDE.md\n\nHướng dẫn cho Claude.\n\n## Commands\n- npm run dev\n'
      : '# AGENTS.md\n\nHướng dẫn cho Codex, viết khác hẳn.\n\n## Commands\n- npm run dev\n';
  assert.doesNotThrow(() => checkAgentDocsSync(readFile));
});

test('thân nội dung lệch thì báo lỗi kèm số dòng', () => {
  const readFile = (name) =>
    name === 'CLAUDE.md'
      ? '# CLAUDE.md\n\n## Commands\n- npm run dev\n- npm run build\n'
      : '# AGENTS.md\n\n## Commands\n- npm run dev\n- npm run build:server\n';
  assert.throws(
    () => checkAgentDocsSync(readFile),
    (error) => error instanceof AgentDocsSyncError && /dòng 3/.test(error.message),
  );
});

test('một file thêm mục mới mà file kia chưa có thì bị bắt', () => {
  const readFile = (name) =>
    name === 'CLAUDE.md'
      ? '# CLAUDE.md\n\n## Commands\n- npm run dev\n\n### Mục mới\n- điều quan trọng\n'
      : '# AGENTS.md\n\n## Commands\n- npm run dev\n';
  assert.throws(() => checkAgentDocsSync(readFile), AgentDocsSyncError);
});

test('CRLF của Windows không bị báo nhầm là lệch', () => {
  const readFile = (name) =>
    name === 'CLAUDE.md'
      ? '# CLAUDE.md\r\n\r\n## Commands\r\n- npm run dev\r\n'
      : '# AGENTS.md\n\n## Commands\n- npm run dev\n';
  assert.doesNotThrow(() => checkAgentDocsSync(readFile));
});

test('thiếu mốc thân chung thì báo lỗi rõ ràng', () => {
  assert.throws(
    () => extractSharedBody('# CLAUDE.md\n\nkhông có mốc nào\n', 'CLAUDE.md'),
    (error) => error instanceof AgentDocsSyncError && /không tìm thấy mốc/.test(error.message),
  );
});

test('diff trả về null khi hai thân giống nhau', () => {
  assert.equal(diffSharedBodies('## Commands\na\n', '## Commands\na\n'), null);
});
