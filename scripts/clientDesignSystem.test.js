import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

/**
 * Chốt lại: mọi class thuộc bộ từ vựng thiết kế riêng của dự án phải có định nghĩa
 * trong client/src/styles/global.css.
 *
 * Bối cảnh: 53 class từng được TSX tham chiếu mà KHÔNG hề có một dòng CSS nào.
 * UserManagement, TenantManagement, SecretsPanel và StudentPractice dựng gần như toàn
 * bộ bố cục trên chúng, nên các trang đó đổ về dòng chảy mặc định — modal mất lớp phủ
 * và mất định vị, badge trạng thái thành chữ trơn, lưới biểu mẫu thành chồng dọc.
 *
 * Kiểu hỏng này im lặng tuyệt đối: TypeScript không kiểm tra chuỗi className, Vite vẫn
 * build xanh, không có cảnh báo nào ở console. Chỉ mở đúng trang bằng mắt mới thấy.
 * Vì vậy phải có test đọc thẳng source, cùng quy ước với questionIdentity.test.ts.
 */

const CLIENT_SRC = path.resolve(process.cwd(), 'client', 'src');
const GLOBAL_CSS = path.join(CLIENT_SRC, 'styles', 'global.css');

// Bộ từ vựng RIÊNG của dự án. Không liệt kê utility của Tailwind ở đây — chúng do
// Tailwind sinh ra và không thể "mất định nghĩa" theo kiểu này.
const PROJECT_CLASS_PATTERN = new RegExp(
  '^(' + [
    'admin-shell', 'admin-topbar', 'topbar-actions',
    'notice(-error|-success)?',
    'panel-section', 'tenant-config-card', 'provision-card', 'section-heading',
    'form-grid', 'form-footer', 'field', 'field-wide', 'checkbox-field',
    'status-badge', 'status-dot', 'status-row', 'count-pill', 'approval-banner',
    'provision-actions',
    'tenant-layout', 'tenant-list', 'tenant-list-item', 'tenant-list-copy',
    'tenant-title-row', 'tenant-avatar', 'tenant-workspace',
    'metric-grid', 'metric-card', 'metric-success', 'metric-warn', 'resource-grid',
    'empty-state', 'empty-icon', 'icon-button',
    'modal-backdrop', 'modal-card', 'terraform-log',
    'practice-layout', 'practice-content-panel', 'practice-editor-panel',
    'run-output-panel', 'run-output-header', 'run-output-body',
    'hide-scrollbar', 'fade-in',
    'btn', 'btn-primary', 'btn-secondary', 'btn-danger', 'btn-danger-outline', 'btn-ghost',
    'button-row', 'eyebrow', 'card', 'container', 'header', 'nav',
    'form-group', 'error', 'success', 'loading',
    'violation-warning', 'exam-timer', 'question-content',
  ].join('|') + ')$',
);

// Trạng thái động: className={`status-${tenant.status}`} và các họ tương tự. Không quét
// được bằng chuỗi tĩnh nên chốt cứng ở đây theo giá trị thật mà backend sinh ra.
const DYNAMIC_STATE_CLASSES = [
  'status-approved', 'status-pending', 'status-suspended', 'status-active',
  'provision-active', 'provision-queued', 'provision-running', 'provision-failed',
  'job-succeeded', 'job-queued', 'job-running', 'job-failed',
];

function readCss() {
  return fs.readFileSync(GLOBAL_CSS, 'utf8');
}

function collectTsxFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTsxFiles(full));
    else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name)) found.push(full);
  }
  return found;
}

function usedProjectClasses() {
  const used = new Map();
  for (const file of collectTsxFiles(CLIENT_SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = (match[1] || match[2] || '').replace(/\$\{[^}]*\}/g, ' ');
      for (const token of raw.split(/\s+/)) {
        if (PROJECT_CLASS_PATTERN.test(token)) {
          if (!used.has(token)) used.set(token, path.basename(file));
        }
      }
    }
  }
  return used;
}

function isDefined(css, className) {
  // Khớp `.ten` khi không có ký tự định danh liền sau, để `.btn` không ăn nhầm
  // định nghĩa của `.btn-primary`.
  return new RegExp('\\.' + className.replace(/[-]/g, '\\-') + '(?![a-zA-Z0-9_-])').test(css);
}

test('mọi class thiết kế riêng dùng trong TSX đều có định nghĩa trong global.css', () => {
  const css = readCss();
  const used = usedProjectClasses();
  assert.ok(used.size > 20, `chỉ tìm thấy ${used.size} class — bộ quét hỏng chứ không phải code sạch`);

  const missing = [];
  for (const [className, file] of used) {
    if (!isDefined(css, className)) missing.push(`${className} (dùng ở ${file})`);
  }
  assert.deepEqual(
    missing,
    [],
    'class được tham chiếu nhưng không có CSS — trang sẽ đổ về dòng chảy mặc định mà build vẫn xanh',
  );
});

test('các class trạng thái sinh động đều có màu', () => {
  // className={`status-${tenant.status}`} không quét tĩnh được, nên nếu thiếu thì badge
  // im lặng rơi về màu xám trung tính và mọi trạng thái trông giống hệt nhau.
  const css = readCss();
  const missing = DYNAMIC_STATE_CLASSES.filter((name) => !isDefined(css, name));
  assert.deepEqual(missing, [], 'thiếu màu cho trạng thái sinh động');
});

test('nút phá hủy và nút mờ phải có nền hoặc viền riêng', () => {
  // Cả hai chỉ kế thừa .btn, vốn là border-transparent và không có nền — thiếu định
  // nghĩa riêng thì chúng hiện ra như chữ trơn, người dùng không nhận ra là nút.
  const css = readCss();
  for (const name of ['btn-danger-outline', 'btn-ghost']) {
    assert.ok(isDefined(css, name), `thiếu .${name}`);
  }
});
