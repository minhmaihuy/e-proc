import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db from '../db/postgres.js';
// Tài khoản quản trị sống ở control-plane, không phải data-plane khảo thí.
import controlDb from '../db/controlPlane.js';
import mammoth from 'mammoth';
import { normalizeUnicode, stripHtml, sanitizeFilename, buildContentDisposition } from '../../utils/string.js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { authMiddleware, requireTenantUserManager } from '../middleware/auth.js';
import { canManageTenantUser } from '../tenantContext.js';
import crypto from 'crypto';
import { parseBlueprintCompat } from '../services/blueprint.js';
import { resolveBatchRecordMode } from '../services/recordingPolicy.js';
import { createRecordingViewUrl, isS3Configured } from '../services/s3.js';

dotenv.config();

const USE_SQLITE = !process.env.DATABASE_URL;

console.log('[Admin] USE_SQLITE:', USE_SQLITE, 'NODE_ENV:', process.env.NODE_ENV);

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// =============================================
// PROTECTED ROUTES — Require JWT từ đây trở xuống
// =============================================
router.use(authMiddleware);

// ── Quản lý người dùng trong tenant ─────────────────────────────
//
// Phải dùng controlDb, KHÔNG dùng db (data-plane). Tài khoản sống ở control-plane;
// bản sao trong data-plane chỉ còn để rollback và không ai đọc nữa. Trước đây cả
// bốn route này đều ghi nhầm sang data-plane, nên:
//   - danh sách luôn rỗng dù tenant có tài khoản thật,
//   - tài khoản tạo ra không đăng nhập được,
//   - và nguy hiểm nhất: xoá báo thành công nhưng tài khoản thật vẫn đăng nhập được.
//
// Vai trò hợp lệ trong một tenant: `tenant_admin` (quản lý người dùng) và `admin`
// (giáo viên / cộng tác viên). `superadmin` là toàn cục và không bao giờ được tạo
// hay sửa từ đây.

const TENANT_ROLES = ['tenant_admin', 'admin'] as const;
type TenantRole = typeof TENANT_ROLES[number];

function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (TENANT_ROLES as readonly string[]).includes(value);
}

const USERNAME_PATTERN = /^[A-Za-z0-9_.@-]{3,100}$/;

function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password must contain 8-128 characters.';
  }
  return null;
}

/** Đếm số tenant_admin còn lại, trừ một id. Dùng để không xóa/hạ cấp người cuối cùng. */
async function otherTenantAdminCount(tenantId: number, excludeId: number): Promise<number> {
  const result = await controlDb.query(
    "SELECT COUNT(*) AS count FROM admin_users WHERE role = 'tenant_admin' AND tenant_id = ? AND id <> ?",
    [tenantId, excludeId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Nạp mục tiêu và kiểm tra người gọi có quyền quản lý nó không. */
async function loadManageableUser(req: Request, targetId: number) {
  const actor = req.adminUser!;
  const result = await controlDb.query(
    'SELECT id, username, role, tenant_id FROM admin_users WHERE id = ?',
    [targetId],
  );
  const target = result.rows[0];
  if (!target) return { error: { status: 404, message: 'User not found' } } as const;

  // canManageTenantUser chốt ba điều: người gọi là tenant_admin, cùng tenant với mục
  // tiêu, và mục tiêu không phải superadmin.
  if (!canManageTenantUser(
    { role: actor.role, tenantId: actor.tenantId },
    { role: String(target.role), tenantId: target.tenant_id === null ? null : Number(target.tenant_id) },
  )) {
    return { error: { status: 403, message: 'Forbidden: account belongs to another tenant' } } as const;
  }
  return { target } as const;
}

// GET /api/admin/users — liệt kê người dùng CỦA TENANT HIỆN TẠI
router.get('/users', requireTenantUserManager, async (req: Request, res: Response) => {
  try {
    const result = await controlDb.query(
      `SELECT id, username, role, tenant_id, created_at
         FROM admin_users
        WHERE tenant_id = ? AND role <> 'superadmin'
        ORDER BY id ASC`,
      [req.adminUser!.tenantId],
    );
    return res.json(result.rows);
  } catch (err: any) {
    console.error('[Users] list error:', err);
    return res.status(500).json({ error: 'Unable to load tenant users.' });
  }
});

// POST /api/admin/users — tạo người dùng trong tenant hiện tại
router.post('/users', requireTenantUserManager, async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body;
    const trimmed = typeof username === 'string' ? username.trim() : '';

    if (!USERNAME_PATTERN.test(trimmed)) {
      return res.status(400).json({ error: 'Username must contain 3-100 letters, numbers, dots, dashes, @ or underscores.' });
    }
    const badPassword = passwordProblem(password);
    if (badPassword) return res.status(400).json({ error: badPassword });

    // Validate cũ nhận 'admin' hoặc 'mod' — mô hình vai trò đã bỏ từ lâu. Hệ quả: tạo
    // tenant_admin luôn bị 400, còn 'mod' lại được chấp nhận và sinh ra tài khoản chết
    // vì không guard nào nhận ra vai trò đó.
    if (!isTenantRole(role)) {
      return res.status(400).json({ error: 'Role must be "tenant_admin" or "admin".' });
    }

    const existing = await controlDb.query(
      'SELECT id FROM admin_users WHERE LOWER(username) = LOWER(?)',
      [trimmed],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // tenant_id lấy từ JWT của người gọi, KHÔNG lấy từ body: nếu tin body thì một
    // tenant_admin có thể tự tạo tài khoản sang tenant khác.
    const passwordHash = await bcrypt.hash(password, 12);
    await controlDb.query(
      'INSERT INTO admin_users (username, password_hash, role, tenant_id) VALUES (?, ?, ?, ?)',
      [trimmed, passwordHash, role, req.adminUser!.tenantId],
    );
    console.log('[Users] created', trimmed, 'role', role, 'tenant', req.adminUser!.tenantId);
    return res.status(201).json({ success: true });
  } catch (err: any) {
    console.error('[Users] create error:', err);
    return res.status(500).json({ error: 'Unable to create account.' });
  }
});

// PUT /api/admin/users/:id — đổi vai trò hoặc đặt lại mật khẩu
// Route này trước đây KHÔNG TỎN TẠI dù client vẫn gọi — mọi thao tác đổi vai trò
// và đặt lại mật khẩu trên giao diện đều nhận 404.
router.put('/users/:id', requireTenantUserManager, async (req: Request, res: Response) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });

    const { role, password } = req.body;
    if (role === undefined && password === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const loaded = await loadManageableUser(req, targetId);
    if ('error' in loaded) return res.status(loaded.error.status).json({ error: loaded.error.message });
    const { target } = loaded;
    const actor = req.adminUser!;

    if (role !== undefined) {
      if (!isTenantRole(role)) {
        return res.status(400).json({ error: 'Role must be "tenant_admin" or "admin".' });
      }
      // Tự hạ cấp chính mình là cách nhanh nhất để khoá cả tenant ra ngoài.
      if (target.id === actor.id) {
        return res.status(400).json({ error: 'Cannot change your own role' });
      }
      if (
        target.role === 'tenant_admin'
        && role !== 'tenant_admin'
        && (await otherTenantAdminCount(Number(target.tenant_id), targetId)) === 0
      ) {
        return res.status(400).json({ error: 'Cannot demote the last tenant administrator' });
      }
      await controlDb.query(
        'UPDATE admin_users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [role, targetId],
      );
    }

    if (password !== undefined) {
      const badPassword = passwordProblem(password);
      if (badPassword) return res.status(400).json({ error: badPassword });
      // Đổi mật khẩu của chính mình phải qua /change-password, vì chỗ đó bắt nhập
      // mật khẩu hiện tại. Đi đường này là bỏ qua bước xác minh đó.
      if (target.id === actor.id) {
        return res.status(400).json({ error: 'Use change-password for your own account' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await controlDb.query(
        'UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [passwordHash, targetId],
      );
    }

    console.log('[Users] updated', targetId, 'by', actor.id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Users] update error:', err);
    return res.status(500).json({ error: 'Unable to update account.' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireTenantUserManager, async (req: Request, res: Response) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });
    if (req.adminUser?.id === targetId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const loaded = await loadManageableUser(req, targetId);
    if ('error' in loaded) return res.status(loaded.error.status).json({ error: loaded.error.message });
    const { target } = loaded;

    // Xoá tenant_admin cuối cùng là khoá tenant ra ngoài vĩnh viễn: superadmin cố tình
    // không quản lý được người dùng của tenant nên không ai dựng lại được.
    if (
      target.role === 'tenant_admin'
      && (await otherTenantAdminCount(Number(target.tenant_id), targetId)) === 0
    ) {
      return res.status(400).json({ error: 'Cannot delete the last tenant administrator' });
    }

    await controlDb.query('DELETE FROM admin_users WHERE id = ?', [targetId]);
    console.log('[Users] deleted', targetId, 'by', req.adminUser?.id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Users] delete error:', err);
    return res.status(500).json({ error: 'Unable to delete account.' });
  }
});

// Client gửi UTC ISO string, server chỉ cần validate và normalize
const toStorageTime = (isoStr: string): string => {
  if (!isoStr) return isoStr;
  return new Date(isoStr).toISOString();
};

// Test endpoint to debug blueprint
router.get('/test-blueprint/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log('=== TEST BLUEPRINT ===');
    console.log('batchId:', id);
    
    const batchResult = await db.query('SELECT id, blueprint FROM batches WHERE id = ?', [parseInt(id)]);
    const batch = batchResult.rows[0];
    
    console.log('Batch found:', batch ? 'YES' : 'NO');
    console.log('Blueprint raw:', batch?.blueprint);
    console.log('Blueprint type:', typeof batch?.blueprint);
    
    if (!batch) {
      return res.json({ error: 'Batch not found' });
    }
    
    let blueprint;
    try {
      blueprint = typeof batch.blueprint === 'string' ? JSON.parse(batch.blueprint) : batch.blueprint;
    } catch (e) {
      console.log('JSON parse error:', e);
      blueprint = [];
    }
    
    console.log('Blueprint parsed:', JSON.stringify(blueprint));
    
    // Check question_bank
    const modulesResult = await db.query('SELECT DISTINCT module FROM question_bank');
    console.log('Available modules:', modulesResult.rows.map(r => r.module));
    
    const { items: blueprintItems } = parseBlueprintCompat(blueprint);
    for (const item of blueprintItems) {
      const easy = item.easy || 0;
      const medium = item.medium || 0;
      const hard = item.hard || 0;
      
      console.log(`Module ${item.module}: easy=${easy}, medium=${medium}, hard=${hard}`);
      
      if (easy > 0) {
        const r = await db.query('SELECT COUNT(*) as cnt FROM question_bank WHERE module = ? AND level = ?', [item.module, 'Easy']);
        console.log(`  Easy: ${r.rows[0].cnt} available`);
      }
      if (medium > 0) {
        const r = await db.query('SELECT COUNT(*) as cnt FROM question_bank WHERE module = ? AND level = ?', [item.module, 'Medium']);
        console.log(`  Medium: ${r.rows[0].cnt} available`);
      }
      if (hard > 0) {
        const r = await db.query('SELECT COUNT(*) as cnt FROM question_bank WHERE module = ? AND level = ?', [item.module, 'Hard']);
        console.log(`  Hard: ${r.rows[0].cnt} available`);
      }
    }
    
    res.json({ 
      batch: batch?.id,
      blueprint: blueprint,
      availableModules: modulesResult.rows.map(r => r.module)
    });
  } catch (error: any) {
    console.log('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function extractRubric(rubricStr: string): { mustHave: string; niceToHave: string; optional: string } {
  if (!rubricStr) return { mustHave: '', niceToHave: '', optional: '' };
  
  const parts = rubricStr.split('\n').filter((s: string) => s.trim());
  return {
    mustHave: parts.join('\n'),
    niceToHave: '',
    optional: ''
  };
}

router.post('/questions/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as any[][];
    
    if (rawData.length < 3) {
      return res.status(400).json({ error: 'Invalid file format' });
    }

    const header = rawData[0];
    const rubricHeader = rawData[1];
    
    const colIndex: Record<string, number> = {};
    header.forEach((col, i) => {
      if (col) colIndex[col.toString().trim()] = i;
    });

    let rubricMustHaveCol = colIndex['Rubric (Must-have) (70%)'] ?? 5;
    let rubricNiceCol = colIndex['Nice-to-have (20%)'] ?? 6;
    let rubricOptCol = colIndex['Optional (10%)'] ?? 7;

    console.log('[Import] Header:', header);
    console.log('[Import] Rubric header:', rubricHeader);

    const validLevels = ['Easy', 'Medium', 'Hard'];
    const validTypes = ['Coding', 'Conceptual', 'Fill-in', 'Debug'];
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;
      
      const id = colIndex['ID'] !== undefined ? row[colIndex['ID']] : row[0];
      const type = colIndex['Type'] !== undefined ? row[colIndex['Type']] : row[1];
      const level = colIndex['Level'] !== undefined ? row[colIndex['Level']] : row[2];
      const module = colIndex['Topic'] !== undefined ? row[colIndex['Topic']] : (colIndex['Module'] !== undefined ? row[colIndex['Module']] : row[3]);
      const question = colIndex['Question Sample'] !== undefined ? row[colIndex['Question Sample']] : row[4];
      // Bộ đề: chấp nhận vài tên cột thường gặp; thiếu thì lưu chuỗi rỗng.
      const questionGroupCol = colIndex['QuestionGroup'] ?? colIndex['Question Set'] ?? colIndex['Bộ đề'];
      const questionGroup = (questionGroupCol !== undefined ? row[questionGroupCol]?.toString().trim() : '') || '';
      
      const rubricMustHave = row[rubricMustHaveCol]?.toString() || '';
      const rubricNice = row[rubricNiceCol]?.toString() || '';
      const rubricOpt = row[rubricOptCol]?.toString() || '';
      
      console.log('[Import] Row', i, { id, type, level, module, question: question?.substring(0, 30) });
      
      if (!id || !type || !level || !module || !question) {
        skipped++;
        continue;
      }

      if (!validLevels.includes(level)) {
        errors.push(`Invalid Level "${level}" for ID ${id}`);
        continue;
      }

      if (!validTypes.includes(type)) {
        errors.push(`Invalid Type "${type}" for ID ${id}`);
        continue;
      }

      const normalizedModule = normalizeUnicode(module.toString());
      // question_plain luôn được TÍNH LẠI lúc import, không nhận từ file: nó phải bám
      // sát question_sample, nếu để người dùng cung cấp thì hai bên dễ lệch nhau.
      const questionPlain = stripHtml(question.toString());

      // Trùng lặp tính theo CẶP (id, question_group): hai bộ đề khác nhau được phép dùng
      // chung mã ID mà không ghi đè nhau. Dùng '?' vì query này chạy cho cả hai DB mode —
      // '$1' sẽ nổ dưới SQLite ("Too many parameter values were provided").
      const existing = await db.query(
        "SELECT id FROM question_bank WHERE id = ? AND COALESCE(question_group, '') = ?",
        [id, questionGroup],
      );
      
      if (existing.rows.length > 0) {
        updated++;
      } else {
        imported++;
      }

      if (USE_SQLITE) {
        await db.query(`
          INSERT OR REPLACE INTO question_bank 
          (id, type, level, module, question_group, question_sample, question_plain, rubric_must_have, rubric_nice_to_have, rubric_optional, updated_at, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `, [id, type, level, normalizedModule, questionGroup, question, questionPlain, rubricMustHave, rubricNice, rubricOpt, req.adminUser?.id ?? null]);
      } else {
        const pgQuery = `
          INSERT INTO question_bank 
          (id, type, level, module, question_group, question_sample, question_plain, rubric_must_have, rubric_nice_to_have, rubric_optional, updated_at, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11)
          ON CONFLICT (id, question_group) DO UPDATE SET
            type = EXCLUDED.type,
            level = EXCLUDED.level,
            module = EXCLUDED.module,
            question_sample = EXCLUDED.question_sample,
            question_plain = EXCLUDED.question_plain,
            rubric_must_have = EXCLUDED.rubric_must_have,
            rubric_nice_to_have = EXCLUDED.rubric_nice_to_have,
            rubric_optional = EXCLUDED.rubric_optional,
            updated_at = CURRENT_TIMESTAMP,
            uploaded_by = EXCLUDED.uploaded_by
        `;
        console.log('[Import] PG Query:', pgQuery);
        await db.query(pgQuery, [id, type, level, normalizedModule, questionGroup, question, questionPlain, rubricMustHave, rubricNice, rubricOpt, req.adminUser?.id ?? null]);
      }
    }

    console.log(`[Import] Imported: ${imported}, Updated: ${updated}, Skipped: ${skipped}`);
    
    res.json({
      success: true,
      imported,
      updated,
      skipped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import ngân hàng câu hỏi QUIZ (SingleChoice / MultipleChoice) từ Excel.
// Template MỚI (header 1 dòng): ID | Type | Level | Topic | Question Sample |
//   Option A | Option B | Option C | Option D | Option E | Option F | Correct | Score
// Correct: chữ cái (A) cho single; nhiều chữ cách nhau phẩy (A,C,D) cho multiple.
// Score: điểm câu (mặc định 1). Option để trống → câu ít lựa chọn hơn.
router.post('/questions/quiz/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as any[][];

    if (rawData.length < 2) {
      return res.status(400).json({ error: 'Invalid file format' });
    }

    const header = rawData[0];
    const colIndex: Record<string, number> = {};
    header.forEach((col, i) => {
      if (col) colIndex[col.toString().trim()] = i;
    });

    const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
    const validLevels = ['Easy', 'Medium', 'Hard'];
    const validTypes = ['SingleChoice', 'MultipleChoice'];
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const get = (row: any[], name: string) =>
      colIndex[name] !== undefined ? row[colIndex[name]] : undefined;

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const id = get(row, 'ID');
      const type = get(row, 'Type')?.toString().trim();
      const level = get(row, 'Level')?.toString().trim();
      const module = (get(row, 'Topic') ?? get(row, 'Module'))?.toString();
      const question = get(row, 'Question Sample')?.toString();
      // Cùng quy ước tên cột với import tự luận.
      const questionGroup = (
        get(row, 'QuestionGroup') ?? get(row, 'Question Set') ?? get(row, 'Bộ đề')
      )?.toString().trim() || '';

      if (!id || !type || !level || !module || !question) {
        skipped++;
        continue;
      }
      if (!validLevels.includes(level)) {
        errors.push(`Invalid Level "${level}" for ID ${id}`);
        continue;
      }
      if (!validTypes.includes(type)) {
        errors.push(`Invalid Type "${type}" for ID ${id} (expected SingleChoice/MultipleChoice)`);
        continue;
      }

      // Đọc các option A–F, bỏ qua ô trống
      const options: { key: string; text: string }[] = [];
      for (const key of OPTION_KEYS) {
        const text = get(row, `Option ${key}`);
        if (text !== undefined && text !== null && text.toString().trim() !== '') {
          options.push({ key, text: text.toString() });
        }
      }
      if (options.length < 2) {
        errors.push(`ID ${id}: needs at least 2 options`);
        continue;
      }

      // Correct: "A" hoặc "A,C,D" → mảng key, phải nằm trong options
      const correctRaw = get(row, 'Correct')?.toString() || '';
      const correct = correctRaw
        .split(',')
        .map((s: string) => s.trim().toUpperCase())
        .filter((s: string) => s.length > 0);
      const availableKeys = options.map((o) => o.key);
      const invalidCorrect = correct.filter((c: string) => !availableKeys.includes(c));
      if (correct.length === 0) {
        errors.push(`ID ${id}: missing correct answer (Correct column)`);
        continue;
      }
      if (invalidCorrect.length > 0) {
        errors.push(`ID ${id}: answer "${invalidCorrect.join(',')}" is not among the options`);
        continue;
      }
      if (type === 'SingleChoice' && correct.length !== 1) {
        errors.push(`ID ${id}: SingleChoice must have exactly 1 correct answer, found ${correct.length}`);
        continue;
      }

      const scoreRaw = get(row, 'Score');
      const score = scoreRaw !== undefined && scoreRaw !== '' && !isNaN(Number(scoreRaw))
        ? Number(scoreRaw)
        : 1;

      const normalizedModule = normalizeUnicode(module);
      const questionPlain = stripHtml(question);
      const optionsJson = JSON.stringify(options);
      const correctJson = JSON.stringify(correct);

      const existing = await db.query(
        "SELECT id FROM question_bank WHERE id = ? AND COALESCE(question_group, '') = ?",
        [id, questionGroup],
      );
      if (existing.rows.length > 0) updated++; else imported++;

      // rubric_* là NOT NULL trong schema → điền '' cho câu quiz
      if (USE_SQLITE) {
        await db.query(`
          INSERT OR REPLACE INTO question_bank
          (id, type, level, module, question_group, question_sample, question_plain, rubric_must_have, rubric_nice_to_have, rubric_optional, options, correct_answers, score, updated_at, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, datetime('now'), ?)
        `, [id, type, level, normalizedModule, questionGroup, question, questionPlain, optionsJson, correctJson, score, req.adminUser?.id ?? null]);
      } else {
        await db.query(`
          INSERT INTO question_bank
          (id, type, level, module, question_group, question_sample, question_plain, rubric_must_have, rubric_nice_to_have, rubric_optional, options, correct_answers, score, updated_at, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, '', '', '', $8, $9, $10, CURRENT_TIMESTAMP, $11)
          ON CONFLICT (id, question_group) DO UPDATE SET
            type = EXCLUDED.type,
            level = EXCLUDED.level,
            module = EXCLUDED.module,
            question_sample = EXCLUDED.question_sample,
            question_plain = EXCLUDED.question_plain,
            options = EXCLUDED.options,
            correct_answers = EXCLUDED.correct_answers,
            score = EXCLUDED.score,
            updated_at = CURRENT_TIMESTAMP,
            uploaded_by = EXCLUDED.uploaded_by
        `, [id, type, level, normalizedModule, questionGroup, question, questionPlain, optionsJson, correctJson, score, req.adminUser?.id ?? null]);
      }
    }

    console.log(`[QuizImport] Imported: ${imported}, Updated: ${updated}, Skipped: ${skipped}`);
    res.json({
      success: true,
      imported,
      updated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Quiz import error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/questions', async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM question_bank ORDER BY module, level');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/questions/question-groups — danh sách bộ đề đang có.
 * Dùng cho dropdown lọc ở trang Question Bank: khi hai bộ dùng chung mã ID thì cột
 * ID không còn phân biệt được câu nào thuộc bộ nào.
 */
router.get('/questions/question-groups', async (_req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT question_group FROM question_bank
      WHERE question_group IS NOT NULL AND question_group != ''
      ORDER BY question_group
    `);
    res.json(result.rows.map((r: any) => r.question_group));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/questions/modules', async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT DISTINCT module FROM question_bank ORDER BY module');
    res.json(result.rows.map((m: any) => m.module));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Returns question counts per module broken down by difficulty level
/**
 * Thống kê theo CẶP (module, question_group).
 *
 * Cùng một tên module có thể tồn tại ở nhiều bộ đề — ví dụ "chapter 10: unit testing"
 * có mặt ở cả CPP_EMB_PRINT_IOT lẫn CPP_EMB_AUTOSAR. Nếu blueprint chỉ chọn theo
 * module thì đề của học viên sẽ trộn câu từ cả hai bộ, điều gần như không bao giờ là
 * ý định của người ra đề.
 */
router.get('/questions/module-groups', async (_req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT module, COALESCE(question_group, '') AS question_group
      FROM question_bank
      ORDER BY module, question_group
    `);
    res.json(result.rows.map((r: any) => ({
      module: r.module,
      question_group: r.question_group || '',
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/questions/module-group-stats', async (_req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        module,
        COALESCE(question_group, '') AS question_group,
        SUM(CASE WHEN LOWER(level) = 'easy'   THEN 1 ELSE 0 END) AS easy,
        SUM(CASE WHEN LOWER(level) = 'medium' THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN LOWER(level) = 'hard'   THEN 1 ELSE 0 END) AS hard
      FROM question_bank
      GROUP BY module, COALESCE(question_group, '')
      ORDER BY module, question_group
    `);
    res.json(result.rows.map((r: any) => ({
      module: r.module,
      question_group: r.question_group || '',
      easy:   Number(r.easy)   || 0,
      medium: Number(r.medium) || 0,
      hard:   Number(r.hard)   || 0,
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/questions/module-group-type-stats', async (_req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        module,
        COALESCE(question_group, '') AS question_group,
        type,
        SUM(CASE WHEN LOWER(level) = 'easy'   THEN 1 ELSE 0 END) AS easy,
        SUM(CASE WHEN LOWER(level) = 'medium' THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN LOWER(level) = 'hard'   THEN 1 ELSE 0 END) AS hard
      FROM question_bank
      GROUP BY module, COALESCE(question_group, ''), type
      ORDER BY module, question_group, type
    `);
    res.json(result.rows.map((r: any) => ({
      module: r.module,
      question_group: r.question_group || '',
      type: r.type,
      easy:   Number(r.easy)   || 0,
      medium: Number(r.medium) || 0,
      hard:   Number(r.hard)   || 0,
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/questions/module-stats', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        module,
        SUM(CASE WHEN LOWER(level) = 'easy'   THEN 1 ELSE 0 END) AS easy,
        SUM(CASE WHEN LOWER(level) = 'medium' THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN LOWER(level) = 'hard'   THEN 1 ELSE 0 END) AS hard
      FROM question_bank
      GROUP BY module
      ORDER BY module
    `);
    res.json(result.rows.map((r: any) => ({
      module: r.module,
      easy:   Number(r.easy)   || 0,
      medium: Number(r.medium) || 0,
      hard:   Number(r.hard)   || 0,
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Returns question counts per type broken down by difficulty level
router.get('/questions/type-stats', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        type,
        SUM(CASE WHEN LOWER(level) = 'easy'   THEN 1 ELSE 0 END) AS easy,
        SUM(CASE WHEN LOWER(level) = 'medium' THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN LOWER(level) = 'hard'   THEN 1 ELSE 0 END) AS hard
      FROM question_bank
      GROUP BY type
      ORDER BY type
    `);
    res.json(result.rows.map((r: any) => ({
      type:   r.type,
      easy:   Number(r.easy)   || 0,
      medium: Number(r.medium) || 0,
      hard:   Number(r.hard)   || 0,
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Returns question counts per (module, type) combination broken down by difficulty level
router.get('/questions/module-type-stats', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        module,
        type,
        SUM(CASE WHEN LOWER(level) = 'easy'   THEN 1 ELSE 0 END) AS easy,
        SUM(CASE WHEN LOWER(level) = 'medium' THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN LOWER(level) = 'hard'   THEN 1 ELSE 0 END) AS hard
      FROM question_bank
      GROUP BY module, type
      ORDER BY module, type
    `);
    res.json(result.rows.map((r: any) => ({
      module: r.module,
      type:   r.type,
      easy:   Number(r.easy)   || 0,
      medium: Number(r.medium) || 0,
      hard:   Number(r.hard)   || 0,
    })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/questions/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No question IDs provided' });
    }

    // Giáo viên/cộng tác viên (`admin`) chỉ xóa được câu hỏi do mình tải lên;
    // `tenant_admin` quản lý toàn tenant nên không bị ràng buộc này.
    if (req.adminUser?.role === 'admin') {
      const userId = req.adminUser?.id;
      if (USE_SQLITE) {
        const placeholders = ids.map(() => '?').join(', ');
        const owned = await db.query(
          `SELECT id FROM question_bank WHERE id IN (${placeholders}) AND uploaded_by = ?`,
          [...ids, userId]
        );
        const ownedIds = new Set(owned.rows.map((r: any) => r.id));
        const forbidden = ids.filter(id => !ownedIds.has(id));
        if (forbidden.length > 0) {
          return res.status(403).json({ error: 'Forbidden: You can only delete questions you uploaded' });
        }
      } else {
        const owned = await db.query(
          `SELECT id FROM question_bank WHERE id = ANY($1::text[]) AND uploaded_by = $2`,
          [ids, userId]
        );
        const ownedIds = new Set(owned.rows.map((r: any) => r.id));
        const forbidden = ids.filter(id => !ownedIds.has(id));
        if (forbidden.length > 0) {
          return res.status(403).json({ error: 'Forbidden: You can only delete questions you uploaded' });
        }
      }
    }

    // Câu hỏi định danh bằng CẶP (id, question_group) → client gửi "id|||group".
    // Chuỗi không có "|||" là định dạng cũ (chỉ id): xóa mọi bộ đề mang id đó, giữ
    // nguyên hành vi trước đây cho client cũ.
    let deleted = 0;
    for (const raw of ids) {
      const key = String(raw);
      const sep = key.indexOf('|||');
      if (sep === -1) {
        const r = await db.query('DELETE FROM question_bank WHERE id = ?', [key]);
        deleted += r.rowCount ?? 0;
      } else {
        const r = await db.query(
          "DELETE FROM question_bank WHERE id = ? AND COALESCE(question_group, '') = ?",
          [key.slice(0, sep), key.slice(sep + 3)],
        );
        deleted += r.rowCount ?? 0;
      }
    }

    res.json({ success: true, deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/questions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Giáo viên/cộng tác viên (`admin`) chỉ xóa được câu hỏi do mình tải lên;
    // `tenant_admin` quản lý toàn tenant nên không bị ràng buộc này.
    if (req.adminUser?.role === 'admin') {
      const own = await db.query('SELECT uploaded_by FROM question_bank WHERE id = ?', [id]);
      if (!own.rows[0] || own.rows[0].uploaded_by !== req.adminUser?.id) {
        return res.status(403).json({ error: 'Forbidden: You can only delete questions you uploaded' });
      }
    }
    // ?group=<question_group> giới hạn đúng bộ đề; không truyền thì xóa mọi bộ đề
    // mang mã này (hành vi cũ, giữ cho client cũ).
    const group = req.query.group;
    if (group !== undefined) {
      await db.query(
        "DELETE FROM question_bank WHERE id = ? AND COALESCE(question_group, '') = ?",
        [id, String(group)],
      );
    } else {
      await db.query('DELETE FROM question_bank WHERE id = ?', [id]);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PRACTICE EXAMS — Quản lý riêng, import từ .docx
// =============================================

// POST /api/admin/practice/import — Upload file .docx + tên bài, convert sang HTML
router.post('/practice/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const name = (req.body.name || '').toString().trim() || req.file.originalname.replace(/\.docx?$/i, '');

    if (!/\.docx$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Only .docx files are supported' });
    }

    const conversion = await mammoth.convertToHtml({ buffer: req.file.buffer });
    const contentHtml = conversion.value;
    if (!contentHtml || contentHtml.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract any content from the .docx file' });
    }
    const contentPlain = stripHtml(contentHtml);

    const result = await db.query(
      `INSERT INTO practice_exams (name, content_html, content_plain) VALUES (?, ?, ?) RETURNING id`,
      [name, contentHtml, contentPlain]
    );
    const id = result.rows[0]?.id ?? result.lastInsertRowid;

    console.log('[Practice] Imported:', name, 'id:', id, 'html length:', contentHtml.length);
    res.status(201).json({ success: true, id, name, warnings: conversion.messages?.map((m: any) => m.message) });
  } catch (error: any) {
    console.error('[Practice] Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/practice — Danh sách bài practice (kèm số batch đang dùng)
router.get('/practice', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.name, p.created_at,
             (SELECT COUNT(*) FROM batches b WHERE b.practice_exam_id = p.id) as batches_count
      FROM practice_exams p
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/practice/:id — Chi tiết (kèm content_html để preview)
router.get('/practice/:id', async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM practice_exams WHERE id = ?', [parseInt(req.params.id)]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Practice exam not found' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/practice/:id — Chặn xoá nếu còn batch đang tham chiếu
router.delete('/practice/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const used = await db.query('SELECT COUNT(*) as count FROM batches WHERE practice_exam_id = ?', [id]);
    const count = Number(used.rows[0]?.count ?? used.rows[0]?.COUNT ?? 0);
    if (count > 0) {
      return res.status(400).json({ error: `Practice exam is used by ${count} batch(es). Delete those batches first.` });
    }
    await db.query('DELETE FROM practice_exams WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batches', async (req: Request, res: Response) => {
  try {
    const { name, start_time, end_time, duration, blueprint, practice_exam_id, record_mode, exam_type } = req.body;
    console.log('[CreateBatch] Input:', { name, start_time, end_time, duration, blueprint, exam_type, record_mode });
    const examType = exam_type === 'quiz' ? 'quiz' : 'essay';

    if (!name || !start_time || !end_time || !duration) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Support both legacy array format and new { blueprintMode, items } object format
    // Batch Practice không dùng blueprint: học viên làm một bài .docx duy nhất.
    // Một batch hoặc theo blueprint, hoặc theo practice — không bao giờ cả hai.
    const isPractice = practice_exam_id !== undefined && practice_exam_id !== null && practice_exam_id !== '';
    if (isPractice) {
      const pe = await db.query('SELECT id FROM practice_exams WHERE id = ?', [parseInt(practice_exam_id)]);
      if (pe.rows.length === 0) {
        return res.status(400).json({ error: 'Practice exam not found' });
      }
    }
    const { items: blueprintItems } = parseBlueprintCompat(blueprint);
    const totalQuestions = blueprintItems.reduce((sum: number, item: any) => sum + (item.easy || 0) + (item.medium || 0) + (item.hard || 0), 0);
    if (!isPractice && (totalQuestions < 1 || totalQuestions > 100)) {
      return res.status(400).json({ error: 'Total questions must be between 1 and 100' });
    }

    const blueprintJson = isPractice ? null : JSON.stringify(blueprint);
    const practiceExamId = isPractice ? parseInt(practice_exam_id) : null;
    console.log('[CreateBatch] Blueprint JSON:', blueprintJson, 'practice:', practiceExamId);
    
    const startUTC = toStorageTime(start_time);
    const endUTC = toStorageTime(end_time);
    console.log('[CreateBatch] Times (UTC stored):', { start_time: startUTC, end_time: endUTC });
    
    // Chế độ ghi màn hình phải nằm trong allowlist mà superadmin cấp cho tenant, và chỉ
    // tenant_admin được đặt. record_enabled giữ đồng bộ (= mode==='s3') để tương thích ngược.
    const recordDecision = resolveBatchRecordMode({
      requested: record_mode,
      allowedForTenant: req.adminUser?.allowedRecordModes ?? ['none'],
      fallback: 'none',
      canChange: req.adminUser?.role === 'tenant_admin',
    });
    if (recordDecision.rejected) {
      return res.status(403).json({ error: recordDecision.reason });
    }
    const recordMode = recordDecision.mode;
    const recordFlag = recordMode === 's3' ? 1 : 0;

    // Lưu người tạo batch
    const createdBy = req.adminUser?.id ?? null;

    let result;
    if (USE_SQLITE) {
      result = await db.query(`
        INSERT INTO batches (name, start_time, end_time, duration, blueprint, practice_exam_id, record_enabled, record_mode, exam_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [name, startUTC, endUTC, duration, blueprintJson, practiceExamId, recordFlag, recordMode, examType, createdBy]);
    } else {
      result = await db.query(`
        INSERT INTO batches (name, start_time, end_time, duration, blueprint, practice_exam_id, record_enabled, record_mode, exam_type, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [name, startUTC, endUTC, duration, blueprintJson, practiceExamId, !!recordFlag, recordMode, examType, createdBy]);
    }
    console.log('[CreateBatch] Success, id:', result.lastInsertRowid);
    res.json({ success: true, id: result.lastInsertRowid || result.rows?.[0]?.id });
  } catch (error: any) {
    console.error('[CreateBatch] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT b.*, COUNT(s.id) as students_count 
      FROM batches b 
      LEFT JOIN students s ON b.id = s.batch_id 
      GROUP BY b.id 
      ORDER BY b.created_at DESC
    `);
    const batches = result.rows.map((b: any) => ({
      ...b,
      students_count: b.students_count || 0,
      blueprint: b.blueprint ? (typeof b.blueprint === 'string' ? JSON.parse(b.blueprint) : b.blueprint) : null
    }));
    res.json(batches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM batches WHERE id = ?', [parseInt(id)]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    
    const batch = result.rows[0];
    res.json({
      ...batch,
      blueprint: batch.blueprint ? (typeof batch.blueprint === 'string' ? JSON.parse(batch.blueprint) : batch.blueprint) : null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/batches/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, start_time, end_time, duration, blueprint, practice_exam_id, record_mode, exam_type } = req.body;
    const examType = exam_type === 'quiz' ? 'quiz' : 'essay';
    const isPractice = practice_exam_id !== undefined && practice_exam_id !== null && practice_exam_id !== '';
    const practiceExamId = isPractice ? parseInt(practice_exam_id) : null;

    // Giáo viên/cộng tác viên (`admin`) chỉ sửa được đợt thi do mình tạo;
    // `tenant_admin` quản lý toàn tenant nên không bị ràng buộc này.
    if (req.adminUser?.role === 'admin') {
      const own = await db.query('SELECT created_by FROM batches WHERE id = ?', [parseInt(id)]);
      if (!own.rows[0] || own.rows[0].created_by !== req.adminUser?.id) {
        return res.status(403).json({ error: 'Forbidden: You can only edit batches you created' });
      }
    }

    const startUTC = toStorageTime(start_time);
    const endUTC = toStorageTime(end_time);

    // Chế độ ghi màn hình: chỉ tenant_admin đổi được, và chỉ trong allowlist của tenant.
    // Vai trò khác (hoặc mode bị từ chối) → giữ nguyên giá trị đang lưu, không hạ về
    // 'none' vì như vậy sẽ âm thầm tắt ghi màn hình của một đợt thi đang cấu hình sẵn.
    const currentRecord = await db.query('SELECT record_mode FROM batches WHERE id = ?', [parseInt(id)]);
    const existingMode = currentRecord.rows[0]?.record_mode || 'none';
    const recordDecision = resolveBatchRecordMode({
      requested: record_mode,
      allowedForTenant: req.adminUser?.allowedRecordModes ?? ['none'],
      fallback: existingMode,
      canChange: req.adminUser?.role === 'tenant_admin',
    });
    if (recordDecision.rejected) {
      return res.status(403).json({ error: recordDecision.reason });
    }
    const recordMode = recordDecision.mode;
    const recordFlag = recordMode === 's3' ? 1 : 0;

    if (USE_SQLITE) {
      await db.query(`
        UPDATE batches SET name = ?, start_time = ?, end_time = ?, duration = ?, blueprint = ?, practice_exam_id = ?, record_enabled = ?, record_mode = ?, exam_type = ?
        WHERE id = ?
      `, [name, startUTC, endUTC, duration, isPractice ? null : JSON.stringify(blueprint), practiceExamId, recordFlag, recordMode, examType, parseInt(id)]);
    } else {
      await db.query(`
        UPDATE batches SET name = ?, start_time = ?, end_time = ?, duration = ?, blueprint = ?, practice_exam_id = ?, record_enabled = ?, record_mode = ?, exam_type = ?
        WHERE id = ?
      `, [name, startUTC, endUTC, duration, isPractice ? null : JSON.stringify(blueprint), practiceExamId, !!recordFlag, recordMode, examType, parseInt(id)]);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/batches/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const batchId = parseInt(id);

    // Giáo viên/cộng tác viên (`admin`) chỉ xóa được đợt thi do mình tạo;
    // `tenant_admin` quản lý toàn tenant nên không bị ràng buộc này.
    if (req.adminUser?.role === 'admin') {
      const own = await db.query('SELECT created_by FROM batches WHERE id = ?', [batchId]);
      if (!own.rows[0] || own.rows[0].created_by !== req.adminUser?.id) {
        return res.status(403).json({ error: 'Forbidden: You can only delete batches you created' });
      }
    }
    
    // Delete cascade: exam_questions -> students -> batch
    await db.query('DELETE FROM exam_questions WHERE student_id IN (SELECT id FROM students WHERE batch_id = ?)', [batchId]);
    await db.query('DELETE FROM violations WHERE student_id IN (SELECT id FROM students WHERE batch_id = ?)', [batchId]);
    await db.query('DELETE FROM students WHERE batch_id = ?', [batchId]);
    await db.query('DELETE FROM batches WHERE id = ?', [batchId]);
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Một câu hỏi đã chọn — định danh bằng cặp (id, question_group). */
interface PickedQuestion { id: string; questionGroup: string }

/**
 * Chọn ngẫu nhiên `count` câu theo module/level (+ type, question_group nếu có).
 *
 * Khi blueprint item chỉ định question_group thì CHỈ lấy câu của bộ đó — nếu không,
 * một module tồn tại ở hai bộ sẽ cho ra đề trộn lẫn. Blueprint cũ (lưu trước khi có
 * bộ đề) không có trường này nên vẫn lọc theo module như trước, giữ tương thích ngược.
 */
async function pickQuestions(opts: {
  module: string;
  level: string;
  type?: string;
  questionGroup?: string;
  count: number;
}): Promise<PickedQuestion[]> {
  const { module, level, type, questionGroup, count } = opts;
  if (count <= 0) return [];

  const conditions = ['LOWER(module) = ?', 'LOWER(level) = ?'];
  const params: any[] = [module.toLowerCase().trim(), level.toLowerCase().trim()];
  if (type) {
    conditions.push('LOWER(type) = ?');
    params.push(type.toLowerCase().trim());
  }
  if (questionGroup) {
    conditions.push("LOWER(COALESCE(question_group, '')) = ?");
    params.push(questionGroup.toLowerCase().trim());
  }
  params.push(count);

  const r = await db.query(
    `SELECT id, COALESCE(question_group, '') AS question_group FROM question_bank
     WHERE ${conditions.join(' AND ')} ORDER BY RANDOM() LIMIT ?`,
    params,
  );
  return r.rows.map((q: any) => ({ id: q.id, questionGroup: q.question_group || '' }));
}

router.post('/batches/:id/check-feasibility', async (req: Request, res: Response) => {
  try {
    const { blueprint } = req.body;
    const errors: string[] = [];
    const { blueprintMode, items: blueprintItems } = parseBlueprintCompat(blueprint);

    for (const item of blueprintItems) {
      for (const level of ['Easy', 'Medium', 'Hard'] as const) {
        const count = item[level.toLowerCase() as 'easy' | 'medium' | 'hard'];
        if (count > 0) {
          const typeSql = blueprintMode === 'type' ? 'AND LOWER(type) = LOWER(?)' : '';
          const params = blueprintMode === 'type'
            ? [item.module, level, item.type]
            : [item.module, level];
          const result = await db.query(`
            SELECT COUNT(*) as count FROM question_bank
            WHERE LOWER(module) = LOWER(?) AND LOWER(level) = LOWER(?) ${typeSql}
          `, params);

          const available = parseInt(result.rows[0].count);
          if (available < count) {
            errors.push(`Module ${item.module} Level ${level} has only ${available} questions, need ${count}`);
          }
        }
      }
    }

    res.json({ feasible: errors.length === 0, errors });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batches/:id/students/import', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { emails } = req.body;
    
    console.log('==== IMPORT STUDENTS START ====');
    console.log('batchId:', id);
    console.log('emails:', emails);

    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ error: 'Invalid emails array' });
    }

    const generateCode = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(crypto.randomInt(chars.length));
      }
      return code;
    };

    const batchId = parseInt(id);
    const students: {email: string; code: string}[] = [];
    
    console.log('Fetching batch...');
    const batchResult = await db.query('SELECT id, blueprint, practice_exam_id FROM batches WHERE id = ?', [batchId]);
    const batch = batchResult.rows[0];
    console.log('Batch found:', batch ? 'yes' : 'no');
    console.log('Batch blueprint:', batch?.blueprint, 'practice_exam_id:', batch?.practice_exam_id);

    // Batch Practice không có blueprint và không gán câu hỏi: học viên chỉ cần access
    // code để vào làm bài .docx. Bắt buộc blueprint ở đây sẽ chặn mất luồng practice.
    const isPracticeBatch = batch?.practice_exam_id !== null && batch?.practice_exam_id !== undefined;

    if (!batch || (!isPracticeBatch && !batch.blueprint)) {
      console.log('[Import Students] ERROR: Batch has no blueprint');
      return res.status(400).json({ error: 'Batch has no blueprint' });
    }
    
    let blueprint;
    try {
      if (typeof batch.blueprint === 'string') {
        blueprint = JSON.parse(batch.blueprint);
      } else {
        blueprint = batch.blueprint;
      }
    } catch (e) {
      console.log('[Import Students] JSON parse error:', e);
      blueprint = [];
    }
    
    console.log('Parsed blueprint:', JSON.stringify(blueprint));
    
    // Support both legacy array and new { blueprintMode, items } formats
    const { items: parsedBlueprintItems } = parseBlueprintCompat(blueprint);
    if (!isPracticeBatch && (!parsedBlueprintItems || parsedBlueprintItems.length === 0)) {
      return res.status(400).json({ error: 'Blueprint is empty' });
    }
    
    const existingResult = await db.query(
      'SELECT LOWER(email) as email FROM students WHERE batch_id = ?', 
      [batchId]
    );
    const existingEmailSet = new Set(existingResult.rows.map((r: any) => r.email));

    const skippedEmails: string[] = [];
    const seenInRequest = new Set();

    const validEmails = emails.filter((email: string) => {
      const emailLower = email.trim().toLowerCase();
      
      if (existingEmailSet.has(emailLower)) {
        skippedEmails.push(email);
        return false;
      }
      
      if (seenInRequest.has(emailLower)) {
        skippedEmails.push(email);
        return false;
      }
      
      seenInRequest.add(emailLower);
      existingEmailSet.add(emailLower);
      return true;
    });

    if (skippedEmails.length > 0) {
      console.log('[Import] Skipped duplicate emails:', skippedEmails);
    }

    for (const email of validEmails) {
      let code = '';
      let studentResult: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateCode();
        try {
          studentResult = await db.query(`
            INSERT INTO students (batch_id, email, access_code, status)
            VALUES (?, ?, ?, 'pending')
            RETURNING id
          `, [batchId, email.trim(), code]);
          break;
        } catch (error: any) {
          const uniqueCollision = error?.code === '23505' || String(error?.message || '').includes('UNIQUE constraint failed');
          if (!uniqueCollision || attempt === 4) throw error;
        }
      }
      if (!studentResult) throw new Error('Could not generate a unique access code');
      
      const studentId = studentResult.rows[0]?.id;
      console.log('Student created:', studentId);
      
      if (!studentId) continue;
      
      // Batch Practice: không gán câu hỏi từ question_bank — học viên làm bài .docx.
      if (isPracticeBatch) {
        students.push({ email: email.trim(), code });
        continue;
      }

      // Câu hỏi được định danh bằng CẶP (id, question_group) — hai bộ đề được phép
      // dùng chung mã ID, nên chỉ giữ id là mất dấu câu thuộc bộ nào.
      const picked: { id: string; questionGroup: string }[] = [];

      // Parse blueprint supporting both legacy (array) and new ({ blueprintMode, items }) formats
      const { blueprintMode, items: blueprintItems } = parseBlueprintCompat(blueprint);
      console.log(`[Import Students] blueprintMode=${blueprintMode}, items count=${blueprintItems.length}`);
      
      for (const item of blueprintItems) {
        const easy   = item.easy   || 0;
        const medium = item.medium || 0;
        const hard   = item.hard   || 0;
        // Blueprint cũ không có trường này → undefined → lọc theo module như trước.
        const questionGroup = item.question_group || '';

        if (blueprintMode === 'type') {
          // By Module + Type: query WHERE module = ? AND type = ? AND level = ?
          const moduleName = (item.module || '').toLowerCase().trim();
          const typeName   = (item.type   || '').toLowerCase().trim();
          console.log(`Processing by module+type: ${item.module}/${item.type}, easy=${easy}, medium=${medium}, hard=${hard}`);

          if (easy > 0) {
            const found = await pickQuestions({ module: moduleName, level: 'easy', type: typeName, questionGroup, count: easy });
            console.log(`  Module+Type Easy: found ${found.length}`);
            picked.push(...found);
          }
          if (medium > 0) {
            const found = await pickQuestions({ module: moduleName, level: 'medium', type: typeName, questionGroup, count: medium });
            console.log(`  Module+Type Medium: found ${found.length}`);
            picked.push(...found);
          }
          if (hard > 0) {
            const found = await pickQuestions({ module: moduleName, level: 'hard', type: typeName, questionGroup, count: hard });
            console.log(`  Module+Type Hard: found ${found.length}`);
            picked.push(...found);
          }
        } else {
          // Default: By Module only
          const moduleName = (item.module || '').toLowerCase().trim();
          console.log(`Processing by module: ${item.module} -> ${moduleName}, easy=${easy}, medium=${medium}, hard=${hard}`);

          if (easy > 0) {
            const found = await pickQuestions({ module: moduleName, level: 'easy', questionGroup, count: easy });
            console.log(`  Module Easy: found ${found.length}`);
            picked.push(...found);
          }
          if (medium > 0) {
            const found = await pickQuestions({ module: moduleName, level: 'medium', questionGroup, count: medium });
            console.log(`  Module Medium: found ${found.length}`);
            picked.push(...found);
          }
          if (hard > 0) {
            const found = await pickQuestions({ module: moduleName, level: 'hard', questionGroup, count: hard });
            console.log(`  Module Hard: found ${found.length}`);
            picked.push(...found);
          }
        }
      }
      
      console.log('Total questions:', picked.length);
      
      // Insert into exam_questions — lưu kèm question_group để join về đúng câu.
      for (let i = 0; i < picked.length; i++) {
        await db.query(
          'INSERT INTO exam_questions (student_id, question_id, question_group, question_order) VALUES (?, ?, ?, ?)',
          [studentId, picked[i].id, picked[i].questionGroup, i + 1],
        );
      }
      console.log('Inserted into exam_questions');
      
      students.push({ email: email.trim(), code });
    }

    res.json({ 
      success: true, 
      count: validEmails.length, 
      students,
      skippedEmails: skippedEmails.length > 0 ? skippedEmails : undefined
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches/:id/students', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM students WHERE batch_id = ?', [parseInt(id)]);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/students/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM exam_questions WHERE student_id = ?', [parseInt(id)]);
    await db.query('DELETE FROM violations WHERE student_id = ?', [parseInt(id)]);
    await db.query('DELETE FROM students WHERE id = ?', [parseInt(id)]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches/:id/students/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT email, access_code FROM students WHERE batch_id = ?', [parseInt(id)]);
    const students = result.rows;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=students-${id}.xlsx`);

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(students);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
    const buffer = XLSX.write(workbook, { type: 'buffer' });
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/students/:studentId/reset', async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    
    await db.query(`
      UPDATE students 
      SET status = 'pending', exam_started_at = NULL, exam_deadline = NULL, disconnected_at = NULL,
          submitted_at = NULL, submit_reason = NULL, active_jti = NULL,
          recording_finalized_at = NULL, recording_final_part_index = NULL, recording_incomplete = FALSE
      WHERE id = ?
    `, [parseInt(studentId)]);
    
    await db.query('DELETE FROM exam_questions WHERE student_id = ?', [parseInt(studentId)]);
    await db.query('DELETE FROM recording_parts WHERE student_id = ?', [parseInt(studentId)]);
    // Xóa phiên cũ để lần thi mới không bị false-positive concurrent_session
    await db.query('DELETE FROM exam_sessions WHERE student_id = ?', [parseInt(studentId)]);

    res.json({ success: true, message: 'Student exam reset successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/batches/:id/students/:studentId/recordings
 *
 * Trả về danh sách phần video S3 của một thí sinh kèm presigned GET URL để trainer
 * xem ngay trong trình duyệt. Trước đây hệ thống chỉ ghi nhận "có bao nhiêu phần đã
 * upload" mà không có cách nào mở video ra xem — bằng chứng thu được nhưng không dùng
 * được để phán xử.
 *
 * Ràng buộc an toàn:
 *  - object key lấy từ bảng recording_parts, KHÔNG nhận từ client (tránh việc đoán key
 *    của thí sinh khác hay của tenant khác).
 *  - kiểm tra student thực sự thuộc batch trong URL trước khi ký bất cứ thứ gì.
 *  - chỉ ký cho batch có record_mode='s3'; mode 'local' thì video không nằm trên S3.
 */
/**
 * GET /api/admin/recording-config — chế độ ghi màn hình tenant hiện tại được phép dùng.
 * Trang tạo batch dùng để chỉ hiện những lựa chọn hợp lệ; backend vẫn chặn độc lập.
 */
router.get('/recording-config', async (req: Request, res: Response) => {
  return res.json({
    allowed_record_modes: req.adminUser?.allowedRecordModes ?? ['none'],
    can_change: req.adminUser?.role === 'tenant_admin',
    s3_configured: isS3Configured(),
  });
});

router.get('/batches/:id/students/:studentId/recordings', async (req: Request, res: Response) => {
  try {
    const batchId = parseInt(req.params.id);
    const studentId = parseInt(req.params.studentId);
    if (!Number.isInteger(batchId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ error: 'Invalid batch or student id' });
    }

    const student = await db.query(
      'SELECT s.id, s.email, b.record_mode FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ? AND s.batch_id = ?',
      [studentId, batchId],
    );
    if (student.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found in this batch' });
    }

    const recordMode = student.rows[0].record_mode || 'none';
    if (recordMode !== 's3') {
      return res.json({
        record_mode: recordMode,
        parts: [],
        message: recordMode === 'local'
          ? 'Batch dùng chế độ ghi cục bộ: video nằm trong repo học viên nộp, không có trên S3.'
          : 'Batch này không bật ghi màn hình.',
      });
    }
    if (!isS3Configured()) {
      return res.status(503).json({ error: 'S3 chưa được cấu hình trên máy chủ này.' });
    }

    const parts = await db.query(
      'SELECT part_index, object_key, byte_size, uploaded_at, is_final FROM recording_parts WHERE student_id = ? ORDER BY part_index',
      [studentId],
    );

    const signed = await Promise.all(
      parts.rows.map(async (part: any) => ({
        part_index: part.part_index,
        byte_size: Number(part.byte_size || 0),
        uploaded_at: part.uploaded_at,
        is_final: Boolean(part.is_final),
        url: await createRecordingViewUrl(String(part.object_key)),
      })),
    );

    return res.json({
      record_mode: 's3',
      email: student.rows[0].email,
      parts: signed,
      // Link ký ngắn hạn: nói rõ để UI nhắc trainer tải lại khi hết hạn.
      url_expires_seconds: 300,
    });
  } catch (error: any) {
    console.error('[Recordings] list error:', error);
    return res.status(500).json({ error: 'Không lấy được danh sách bản ghi.' });
  }
});

router.get('/batches/:id/practice-results', async (req: Request, res: Response) => {
  try {
    const batchId = parseInt(req.params.id);

    const result = await db.query(`
      SELECT s.id as student_id, s.email, s.status, s.exam_started_at,
             ps.id as submission_id, ps.answer, ps.ai_score, ps.ai_feedback,
             ps.trainer_score, ps.trainer_feedback,
             (SELECT SUM(v.count) FROM violations v WHERE v.student_id = s.id) as violations
      FROM students s
      LEFT JOIN practice_submissions ps ON ps.student_id = s.id
      WHERE s.batch_id = ?
      ORDER BY s.email
    `, [batchId]);

    res.json(result.rows.map((r: any) => ({ ...r, violations: parseInt(r.violations) || 0 })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/batches/:id/practice-results/export — Xuất Excel kết quả batch Practice
router.get('/batches/:id/practice-results/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const batchId = parseInt(id);

    const batchResult = await db.query('SELECT name FROM batches WHERE id = ?', [batchId]);
    const batchName = batchResult.rows[0]?.name;
    const filenameBase = `${sanitizeFilename(batchName || `batch-${id}`)}-practice-results`;

    const result = await db.query(`
      SELECT s.email, s.status,
             ps.answer, ps.ai_score, ps.ai_feedback, ps.trainer_score, ps.trainer_feedback,
             (SELECT SUM(v.count) FROM violations v WHERE v.student_id = s.id) as violations
      FROM students s
      LEFT JOIN practice_submissions ps ON ps.student_id = s.id
      WHERE s.batch_id = ?
      ORDER BY s.email
    `, [batchId]);

    const data = result.rows.map((r: any) => ({
      Email: r.email,
      Status: r.status,
      'Violation Count': parseInt(r.violations) || 0,
      Answer: r.answer || '',
      'AI Score': r.ai_score ?? 0,
      'AI Feedback': r.ai_feedback || '',
      'Trainer Score': r.trainer_score ?? r.ai_score ?? 0,
      'Trainer Feedback': r.trainer_feedback || '',
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Practice Results');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filenameBase, 'xlsx'));
    res.send(XLSX.write(workbook, { type: 'buffer' }));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/practice-results/:studentId — Trainer chấm/ghi đè điểm bài practice
router.put('/practice-results/:studentId', async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    const { trainer_score, trainer_feedback } = req.body;

    await db.query(`
      UPDATE practice_submissions
      SET trainer_score = ?, trainer_feedback = ?, updated_at = CURRENT_TIMESTAMP
      WHERE student_id = ?
    `, [trainer_score, trainer_feedback, parseInt(studentId)]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches/:id/results', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const batchId = parseInt(id);

    const studentsResult = await db.query(`
      SELECT s.*, 
        AVG(eq.ai_score) as avg_ai_score,
        COUNT(eq.id) as questions_count
      FROM students s
      LEFT JOIN exam_questions eq ON s.id = eq.student_id
      WHERE s.batch_id = ?
      GROUP BY s.id
    `, [batchId]);

    const results = [];
    for (const student of studentsResult.rows) {
      const questionsResult = await db.query(`
        SELECT eq.*, q.type, q.level, q.module, q.question_sample, q.rubric_must_have, q.rubric_nice_to_have, q.rubric_optional
        FROM exam_questions eq
        JOIN question_bank q ON eq.question_id = q.id
          AND COALESCE(eq.question_group, '') = COALESCE(q.question_group, '')
        WHERE eq.student_id = ?
        ORDER BY eq.question_order
      `, [student.id]);

      // [Anti-Cheat v2] Trả về cả tổng lẫn breakdown theo type để admin review
      const violationsResult = await db.query(`
        SELECT SUM(count) as total FROM violations WHERE student_id = ?
      `, [student.id]);

      const violationsBreakdownResult = await db.query(`
        SELECT type, count FROM violations WHERE student_id = ? ORDER BY count DESC
      `, [student.id]);

      // Chuyển array [{type, count}, ...] thành object {tab_switch: 2, suspicious_paste: 1, ...}
      const violationsBreakdown: Record<string, number> = {};
      for (const row of violationsBreakdownResult.rows) {
        violationsBreakdown[row.type] = parseInt(row.count) || 0;
      }

      // Forensic log: từng lần vi phạm kèm preview (500 ký tự) để admin xem qua popup.
      // Bọc riêng: nếu bảng chưa tồn tại (DB cũ chưa migrate) thì trả mảng rỗng
      // thay vì làm sập cả endpoint results.
      let violationEvents: any[] = [];
      try {
        const violationEventsResult = await db.query(`
          SELECT type, text_length, content_preview, question_id, metadata_json, created_at
          FROM violation_events WHERE student_id = ? ORDER BY created_at DESC
        `, [student.id]);
        violationEvents = violationEventsResult.rows;
      } catch (evErr: any) {
        console.error('[results] violation_events query failed (non-fatal):', evErr?.message);
      }

      let recordingParts: any[] = [];
      try {
        const recordingPartsResult = await db.query(`
          SELECT part_index, object_key, byte_size, uploaded_at
          FROM recording_parts WHERE student_id = ? ORDER BY part_index
        `, [student.id]);
        recordingParts = recordingPartsResult.rows;
      } catch (recordErr: any) {
        console.error('[results] recording_parts query failed (non-fatal):', recordErr?.message);
      }

      results.push({
        student,
        questions: questionsResult.rows,
        violations: parseInt(violationsResult.rows[0]?.total) || 0,
        violations_breakdown: violationsBreakdown,
        violation_events: violationEvents,
        recording_parts: recordingParts,
      });
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/results/:studentId', async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;
    const { trainer_score, trainer_feedback } = req.body;

    const questionsResult = await db.query('SELECT id FROM exam_questions WHERE student_id = ?', [parseInt(studentId)]);

    for (const q of questionsResult.rows) {
      await db.query(`
        UPDATE exam_questions 
        SET trainer_score = ?, trainer_feedback = ?
        WHERE id = ?
      `, [trainer_score, trainer_feedback, q.id]);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches/:id/results/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const batchId = parseInt(id);

    const studentsResult = await db.query('SELECT id, email FROM students WHERE batch_id = ?', [batchId]);

    const workbook = XLSX.utils.book_new();

    for (const student of studentsResult.rows) {
      const questionsResult = await db.query(`
        SELECT eq.*, q.type, q.level, q.module, q.question_sample, 
          q.rubric_must_have, q.rubric_nice_to_have, q.rubric_optional
        FROM exam_questions eq
        JOIN question_bank q ON eq.question_id = q.id
          AND COALESCE(eq.question_group, '') = COALESCE(q.question_group, '')
        WHERE eq.student_id = ?
        ORDER BY eq.question_order
      `, [student.id]);

      const violationsResult = await db.query(`
        SELECT SUM(count) as total FROM violations WHERE student_id = ?
      `, [student.id]);

      const data = questionsResult.rows.map((q: any) => ({
        ID: q.question_id,
        Type: q.type,
        Level: q.level,
        Module: q.module,
        Question: q.question_sample,
        Answer: q.answer || '',
        'Rubric Must-have': q.rubric_must_have,
        'Rubric Nice-to-have': q.rubric_nice_to_have,
        'Rubric Optional': q.rubric_optional,
        'AI Feedback': q.ai_feedback || '',
        'AI Score': q.ai_score || 0,
        'Trainer Feedback': q.trainer_feedback || '',
        'Trainer Score': (q.trainer_score ?? q.ai_score) || 0,
        'Violation Count': parseInt(violationsResult.rows[0]?.total) || 0
      }));

      const sheet = XLSX.utils.json_to_sheet(data);
      const sheetName = student.email.split('@')[0] || `Student_${student.id}`;
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName.substring(0, 31));
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=results-${id}.xlsx`);
    res.send(XLSX.write(workbook, { type: 'buffer' }));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/settings/ai', async (req: Request, res: Response) => {
  try {
    if (!USE_SQLITE) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_settings (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL,
          apiKey TEXT,
          model TEXT NOT NULL,
          temperature REAL DEFAULT 0.3,
          maxTokens INTEGER DEFAULT 2048
        )
      `);
    }
    
    const result = await db.query('SELECT * FROM ai_settings LIMIT 1');
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.json({
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-2.0-flash',
        temperature: 0.3,
        maxTokens: 2048
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings/ai', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, temperature, maxTokens } = req.body;
    
    if (USE_SQLITE) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_settings (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL,
          apiKey TEXT,
          model TEXT NOT NULL,
          temperature REAL DEFAULT 0.3,
          maxTokens INTEGER DEFAULT 2048
        )
      `);
      
      await db.query(`
        INSERT OR REPLACE INTO ai_settings (id, provider, apiKey, model, temperature, maxTokens)
        VALUES (1, ?, ?, ?, ?, ?)
      `, [provider, apiKey || '', model, temperature || 0.3, maxTokens || 2048]);
    } else {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_settings (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL,
          apiKey TEXT,
          model TEXT NOT NULL,
          temperature REAL DEFAULT 0.3,
          maxTokens INTEGER DEFAULT 2048
        )
      `);
      
      await db.query(`
        INSERT INTO ai_settings (id, provider, apiKey, model, temperature, maxTokens)
        VALUES (1, $1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          provider = EXCLUDED.provider,
          apiKey = EXCLUDED.apiKey,
          model = EXCLUDED.model,
          temperature = EXCLUDED.temperature,
          maxTokens = EXCLUDED.maxTokens
      `, [provider, apiKey || '', model, temperature || 0.3, maxTokens || 2048]);
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings/ai/test', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model } = req.body;
    
    let response = '';
    
    if (provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const genModel = genAI.getGenerativeModel({ model: model || 'gemini-2.0-flash' });
      const result = await genModel.generateContent('Say "Hello, connection successful!" in one sentence.');
      response = result.response.text();
    } else if (provider === 'openai' || provider === 'azure') {
      response = 'OpenAI/Azure test requires openai package. Using Gemini as fallback.';
    } else if (provider === 'deepseek') {
      response = 'DeepSeek test requires deepseek package. Configure and test manually.';
    } else {
      response = `Provider ${provider} configured. Manual testing recommended.`;
    }
    
    res.json({ success: true, response });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
