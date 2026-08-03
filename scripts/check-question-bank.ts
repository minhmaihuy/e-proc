/**
 * Kiểm tra sức khỏe question_bank sau khi đổi khóa sang (id, question_group).
 *
 * Dùng để:
 *  1. Xem hiện có những bộ đề (question_group) nào, mỗi bộ bao nhiêu câu, phân bổ theo level/type.
 *  2. Phát hiện dấu hiệu dữ liệu ĐÃ BỊ GHI ĐÈ trước đây: các mã ID chỉ còn tồn tại ở
 *     đúng 1 bộ đề trong khi các bộ khác cùng module lại thiếu chính mã đó.
 *  3. Đối chiếu với các file Excel nguồn: truyền đường dẫn file để biết file nào
 *     còn thiếu bao nhiêu câu trong DB.
 *
 * Chạy:
 *   npx tsx scripts/check-question-bank.ts
 *   npx tsx scripts/check-question-bank.ts "D:/path/A.xlsx" "D:/path/B.xlsx"
 *
 * Chỉ ĐỌC dữ liệu — không sửa, không xóa gì.
 */
import * as XLSX from 'xlsx';
import fs from 'fs';
import db from '../src/server/db/postgres.js';

interface QbRow {
  id: string;
  question_group: string;
  module: string;
  level: string;
  type: string;
}

/** Đọc (question_group, id) từ một file Excel theo đúng quy ước của route import. */
function readExcel(path: string): { group: string; ids: string[] } {
  const wb = XLSX.read(fs.readFileSync(path), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
  const header = rows[0] || [];
  const colIndex: Record<string, number> = {};
  header.forEach((c, i) => { if (c) colIndex[c.toString().trim()] = i; });

  const idCol = colIndex['ID'] ?? 0;
  const groupCol = colIndex['QuestionGroup'] ?? colIndex['Question Set'] ?? colIndex['Bộ đề'];

  const ids: string[] = [];
  const groups = new Set<string>();
  // Template tự luận có 2 dòng header (dòng 2 là header phụ của rubric) → data từ dòng 3.
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[idCol]) continue;
    ids.push(r[idCol].toString().trim());
    if (groupCol !== undefined && r[groupCol]) groups.add(r[groupCol].toString().trim());
  }
  return { group: [...groups].join(', ') || '(không có cột QuestionGroup)', ids };
}

async function main() {
  const files = process.argv.slice(2);

  await db.initDatabase();

  const res = await db.query(
    `SELECT id, COALESCE(question_group, '') AS question_group, module, level, type FROM question_bank`
  );
  const rows: QbRow[] = res.rows;
  console.log(`\n=== QUESTION_BANK: ${rows.length} câu ===\n`);

  // 1. Thống kê theo bộ đề
  const byGroup = new Map<string, QbRow[]>();
  for (const r of rows) {
    const g = r.question_group || '(không có group)';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(r);
  }
  console.log('--- Theo bộ đề (question_group) ---');
  for (const [g, list] of [...byGroup.entries()].sort()) {
    const levels = list.reduce((acc: Record<string, number>, r) => {
      acc[r.level] = (acc[r.level] || 0) + 1;
      return acc;
    }, {});
    const modules = new Set(list.map(r => r.module));
    console.log(
      `  ${g.padEnd(28)} ${String(list.length).padStart(4)} câu | ` +
      `Easy ${levels.Easy || 0}, Medium ${levels.Medium || 0}, Hard ${levels.Hard || 0} | ${modules.size} module`
    );
  }

  // 2. ID xuất hiện ở nhiều bộ đề — đây chính là trường hợp trước đây bị ghi đè lẫn nhau
  const idToGroups = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!idToGroups.has(r.id)) idToGroups.set(r.id, new Set());
    idToGroups.get(r.id)!.add(r.question_group || '');
  }
  const shared = [...idToGroups.entries()].filter(([, gs]) => gs.size > 1);
  console.log(`\n--- Mã ID dùng chung bởi nhiều bộ đề: ${shared.length} ---`);
  if (shared.length > 0) {
    console.log('  (Đây là điều BÌNH THƯỜNG sau khi sửa: mỗi bộ giữ câu riêng, không ghi đè nhau)');
    for (const [id, gs] of shared.slice(0, 5)) {
      console.log(`    ${id}: ${[...gs].join(' | ')}`);
    }
    if (shared.length > 5) console.log(`    … và ${shared.length - 5} mã khác`);
  }

  // 3. Đối chiếu với file Excel nguồn
  if (files.length > 0) {
    console.log('\n--- Đối chiếu với file Excel nguồn ---');
    for (const f of files) {
      if (!fs.existsSync(f)) {
        console.log(`  ⚠ Không tìm thấy file: ${f}`);
        continue;
      }
      const { group, ids } = readExcel(f);
      const inDb = new Set(
        rows.filter(r => (r.question_group || '') === group).map(r => r.id)
      );
      const missing = ids.filter(id => !inDb.has(id));
      const name = f.split(/[\\/]/).pop();
      const status = missing.length === 0 ? '✅ đủ' : `❌ THIẾU ${missing.length}`;
      console.log(`  ${name}`);
      console.log(`     group "${group}" | file ${ids.length} câu | DB ${inDb.size} câu → ${status}`);
      if (missing.length > 0) {
        console.log(`     Thiếu: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` … (+${missing.length - 10})` : ''}`);
        console.log(`     → Import lại file này để bù.`);
      }
    }
  } else {
    console.log('\n(Truyền đường dẫn các file .xlsx làm tham số để đối chiếu file ↔ DB)');
  }

  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('Lỗi:', err);
  process.exit(1);
});
