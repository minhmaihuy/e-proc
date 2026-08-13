import { Router, Request, Response } from 'express';
import db from '../db/postgres.js';
import { cache } from '../cache.js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { studentAuthMiddleware } from '../middleware/studentAuth.js';
import type { StudentTokenPayload } from '../middleware/studentAuth.js';
import controlDb from '../db/controlPlane.js';
import { createIdentityUploadUrls, createRecordingUploadUrl, finalizeIdentityObjects, inspectRecordingObject, isIdentityS3Configured, isS3Configured } from '../services/s3.js';
import rateLimit from 'express-rate-limit';
import { sessionTracker, detectConcurrentSession } from '../middleware/sessionTracker.js';
import { getExamContext, assertCanStart, computeExamDeadline, sendExamGuardError, ExamGuardError } from '../services/examGuard.js';
import { parseBlueprintCompat } from '../services/blueprint.js';
import { runCode } from '../coderunner.js';
import { getPracticeCompilerMode, runCodeWithLambda } from '../services/lambdaCompiler.js';
import { enqueueUsageEvent } from '../services/usageOutbox.js';
import { identitySatisfied, normalizeIdentityMode } from '../services/identityPolicy.js';
import { getCurrentTenantConfig } from '../tenantContext.js';

dotenv.config();

const USE_SQLITE = process.env.USE_SQLITE === 'true' || process.env.NODE_ENV !== 'production';

const router = Router();

async function currentIdentityConfig() {
  const row = (await controlDb.query('SELECT identity_verification, identity_retention_days FROM tenants WHERE slug = ?', [
    getCurrentTenantConfig().slug,
  ])).rows[0];
  return {
    mode: normalizeIdentityMode(row?.identity_verification),
    retentionDays: row?.identity_retention_days == null ? null : Number(row.identity_retention_days),
  };
}

async function requireStudentIdentity(studentId: number, res: Response): Promise<boolean> {
  const tenant = await currentIdentityConfig();
  const row = (await db.query(`SELECT s.identity_status, b.identity_verification
    FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`, [studentId])).rows[0];
  const mode = normalizeIdentityMode(row?.identity_verification);
  if (mode === 'face_match' || (mode === 'photo' && tenant.mode !== 'photo')) {
    res.status(403).json({ error: 'Batch identity verification is not permitted by this tenant.', reason: 'identity_required' });
    return false;
  }
  const status = row?.identity_status;
  if (!identitySatisfied(mode, status)) {
    res.status(403).json({ error: 'Identity verification is required before the assessment.', reason: 'identity_required' });
    return false;
  }
  return true;
}

// [SEC] Rate-limit riêng cho /verify — chống brute-force access code.
// 10 lần / phút / IP đủ cho retry hợp lệ nhưng chặn dò mã hàng loạt.
const verifyRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a minute and try again.' },
});

const toGMT7 = (utcDate: Date): Date => {
  return new Date(utcDate.getTime() + 7 * 60 * 60 * 1000);
};

// Hoàn tất nộp bài: quiz → chấm tự động ngay (bỏ qua ai_queue); essay → đẩy hàng đợi AI.
// Dùng chung cho cả nộp thủ công lẫn auto-submit (timeout / vắng mặt quá lâu).
// Không tự set status='submitted' — caller đảm nhiệm việc đó.
async function finalizeSubmission(studentId: number): Promise<void> {
  const batchType = await db.query(`
    SELECT b.exam_type FROM students s JOIN batches b ON s.batch_id = b.id WHERE s.id = ?
  `, [studentId]);
  const examType = batchType.rows[0]?.exam_type || 'essay';

  if (examType === 'quiz') {
    const quizRows = await db.query(`
      SELECT eq.id, eq.answer, q.type, q.correct_answers, q.score
      FROM exam_questions eq
      JOIN question_bank q ON eq.question_id = q.id
        AND COALESCE(eq.question_group, '') = COALESCE(q.question_group, '')
      WHERE eq.student_id = ?
    `, [studentId]);

    const norm = (arr: string[]) => [...new Set(arr.map((s) => String(s).trim().toUpperCase()))].sort();

    for (const row of quizRows.rows) {
      let correct: string[] = [];
      try { correct = row.correct_answers ? JSON.parse(row.correct_answers) : []; } catch (_) {}
      let chosen: string[] = [];
      try { chosen = row.answer ? JSON.parse(row.answer) : []; } catch (_) {
        if (typeof row.answer === 'string' && row.answer.trim()) chosen = [row.answer.trim()];
      }
      const c = norm(correct);
      const a = norm(chosen);
      const isCorrect = c.length > 0 && c.length === a.length && c.every((k, i) => k === a[i]);
      const gained = isCorrect ? (row.score != null ? Number(row.score) : 1) : 0;
      await db.query(
        'UPDATE exam_questions SET ai_score = ?, ai_feedback = ? WHERE id = ?',
        [gained, isCorrect ? 'Correct' : 'Incorrect', row.id]
      );
    }
  } else {
    const examQuestionsResult = await db.query('SELECT id FROM exam_questions WHERE student_id = ?', [studentId]);
    for (const eq of examQuestionsResult.rows) {
      const queued = await db.query('SELECT id FROM ai_queue WHERE exam_question_id = ?', [eq.id]);
      if (queued.rows.length === 0) cache.addToQueue(eq.id, studentId);
    }
  }
}

type SubmitReason = 'manual' | 'timeout' | 'violation' | 'recording_stopped' | 'concurrent_session' | 'absent_too_long';

async function submitExamAtomically(
  studentId: number,
  reason: SubmitReason,
  options: { requireCompleteRecording?: boolean } = {}
): Promise<{ already: boolean }> {
  const transition = await db.withTransaction(async (tx) => {
    const lockSql = `
      SELECT s.status, s.exam_deadline, s.recording_finalized_at, b.record_mode, b.record_enabled
      FROM students s JOIN batches b ON b.id = s.batch_id
      WHERE s.id = ?${USE_SQLITE ? '' : ' FOR UPDATE'}
    `;
    const row = (await tx.query(lockSql, [studentId])).rows[0];
    if (!row) throw new Error('Student not found');
    if (row.status === 'submitted') return { already: true };
    if (row.status !== 'in_progress') throw new Error('Exam is not in progress');

    const recordMode = row.record_mode || (row.record_enabled ? 's3' : 'none');
    const deadlinePassed = row.exam_deadline && new Date() >= new Date(row.exam_deadline);
    const finalReason: SubmitReason = deadlinePassed ? 'timeout' : reason;
    if (options.requireCompleteRecording && !deadlinePassed && recordMode === 's3' && !row.recording_finalized_at) {
      const error: any = new Error('Screen recording has not finished uploading');
      error.code = 'RECORDING_INCOMPLETE';
      throw error;
    }

    await tx.query(
      `UPDATE students
       SET status = 'submitted', submitted_at = ?, submit_reason = ?,
           recording_incomplete = CASE WHEN ? = 's3' AND recording_finalized_at IS NULL THEN TRUE ELSE recording_incomplete END
       WHERE id = ? AND status = 'in_progress'`,
      [new Date().toISOString(), finalReason, recordMode, studentId]
    );
    return { already: false };
  });

  // Idempotent scoring/queueing is deliberately outside the short row-lock transaction.
  await finalizeSubmission(studentId);
  return transition;
}

async function startExamAtomically(studentId: number): Promise<{ success: true; questions_count: number; resume?: boolean }> {
  return db.withTransaction(async (tx) => {
    const context = await getExamContext(studentId, tx);
    assertCanStart(context, new Date(), USE_SQLITE || process.env.SKIP_TIME_CHECK === 'true');

    const locked = (await tx.query(
      `SELECT s.*, b.duration, b.end_time, b.blueprint, b.exam_type
       FROM students s JOIN batches b ON b.id = s.batch_id
       WHERE s.id = ?${USE_SQLITE ? '' : ' FOR UPDATE'}`,
      [studentId]
    )).rows[0];
    assertCanStart({ ...context, status: locked.status }, new Date(), USE_SQLITE || process.env.SKIP_TIME_CHECK === 'true');
    const existing = await tx.query('SELECT COUNT(*) AS count FROM exam_questions WHERE student_id = ?', [studentId]);
    const existingCount = Number(existing.rows[0]?.count || 0);
    if (locked.status === 'in_progress' && existingCount > 0) {
      await tx.query('UPDATE students SET disconnected_at = NULL WHERE id = ?', [studentId]);
      return { success: true, questions_count: existingCount, resume: true };
    }

    await tx.query('DELETE FROM exam_questions WHERE student_id = ?', [studentId]);
    const { blueprintMode, items: blueprintItems } = parseBlueprintCompat(locked.blueprint);
    if (blueprintItems.length === 0) {
      throw new ExamGuardError(422, 'invalid_blueprint', 'Exam blueprint is empty or invalid');
    }
    const examType = locked.exam_type === 'quiz' ? 'quiz' : 'essay';
    const typeFilterSql = examType === 'quiz'
      ? `AND type IN ('SingleChoice', 'MultipleChoice')`
      : `AND type NOT IN ('SingleChoice', 'MultipleChoice')`;
    const picked: { id: string; type: string; options: string | null }[] = [];

    for (const item of blueprintItems) {
      if (!item || typeof item.module !== 'string' || !item.module.trim()) {
        throw new ExamGuardError(422, 'invalid_blueprint', 'Exam blueprint contains an invalid module');
      }
      if (blueprintMode === 'type' && (typeof item.type !== 'string' || !item.type.trim())) {
        throw new ExamGuardError(422, 'invalid_blueprint', 'Exam blueprint contains an invalid question type');
      }
      for (const level of ['Easy', 'Medium', 'Hard'] as const) {
        const count = Number(item[level.toLowerCase()] || 0);
        if (count <= 0) continue;
        const blueprintTypeSql = blueprintMode === 'type' ? 'AND LOWER(type) = LOWER(?)' : '';
        const queryParams = blueprintMode === 'type'
          ? [item.module.trim(), level, item.type!.trim(), count]
          : [item.module.trim(), level, count];
        const available = await tx.query(`
          SELECT id, type, options FROM question_bank
          WHERE LOWER(module) = LOWER(?) AND LOWER(level) = LOWER(?) ${blueprintTypeSql} ${typeFilterSql}
          ORDER BY RANDOM() LIMIT ?
        `, queryParams);
        for (const q of available.rows) picked.push({ id: q.id, type: q.type, options: q.options ?? null });
      }
    }

    for (let i = picked.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    for (let i = 0; i < picked.length; i++) {
      const q = picked[i];
      let optionOrder: string | null = null;
      if ((q.type === 'SingleChoice' || q.type === 'MultipleChoice') && q.options) {
        try {
          const keys = (JSON.parse(q.options) as { key: string }[]).map((option) => option.key);
          for (let a = keys.length - 1; a > 0; a--) {
            const b = crypto.randomInt(a + 1);
            [keys[a], keys[b]] = [keys[b], keys[a]];
          }
          optionOrder = JSON.stringify(keys);
        } catch {}
      }
      await tx.query(
        'INSERT INTO exam_questions (student_id, question_id, question_order, option_order) VALUES (?, ?, ?, ?)',
        [studentId, q.id, i + 1, optionOrder]
      );
    }

    const now = new Date();
    const batchEnd = new Date(locked.end_time);
    const deadline = computeExamDeadline(now, Number(locked.duration || 30), batchEnd);
    await tx.query(
      `UPDATE students SET status = 'in_progress', exam_started_at = ?, exam_deadline = ?,
       disconnected_at = NULL, recording_finalized_at = NULL, recording_final_part_index = NULL,
       recording_incomplete = FALSE WHERE id = ?`,
      [now.toISOString(), deadline.toISOString(), studentId]
    );
    return { success: true, questions_count: picked.length };
  });
}

/**
 * Anti-Cheat: đánh giá phiên đồng thời và cưỡng chế xử lý.
 * - suspicious (đổi IP/UA/nhiều jti) → chỉ ghi forensic 'concurrent_session'.
 * - lockable (chồng lấn thời gian) → ghi forensic + auto-submit ngay ở backend.
 * Bọc try/catch toàn bộ: lỗi detect KHÔNG được làm hỏng request thi.
 * Trả về true nếu đã auto-lock (để caller biết mà dừng phục vụ nội dung).
 */
async function enforceConcurrentSession(studentId: number, batchId: number): Promise<boolean> {
  try {
    const ev = await detectConcurrentSession(studentId);
    if (!ev.suspicious) return false;

    // Ghi forensic một lần cho mỗi lần phát hiện (append-only)
    try {
      const metadataJson = JSON.stringify({
        ips: ev.ips,
        userAgents: ev.userAgents,
        jtis: ev.jtis,
        overlap: ev.overlap,
      }).slice(0, 2000);
      await db.query(
        'INSERT INTO violation_events (student_id, batch_id, type, text_length, content_preview, question_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [studentId, batchId, 'concurrent_session', ev.ips.length, `IPs: ${ev.ips.join(', ')}`.slice(0, 500), null, metadataJson]
      );
    } catch (logErr: any) {
      console.error('[concurrent_session] forensic log failed (non-fatal):', logErr?.message);
    }

    if (ev.lockable) {
      const statusRow = await db.query('SELECT status FROM students WHERE id = ?', [studentId]);
      if (statusRow.rows[0]?.status === 'in_progress') {
        await submitExamAtomically(studentId, 'concurrent_session');
        console.log('[concurrent_session] Auto-submitted (overlap) student:', studentId, 'ips:', ev.ips);
        return true;
      }
    }
    return false;
  } catch (err: any) {
    console.error('[enforceConcurrentSession] failed:', err?.message);
    throw err;
  }
}

router.post('/verify', verifyRateLimit, async (req: Request, res: Response) => {
  try {
    const { access_code } = req.body;

    if (!access_code) {
      return res.status(400).json({ error: 'Access code required' });
    }

    const result = await db.query(`
      SELECT s.*, b.name as batch_name, b.start_time, b.end_time, b.duration, b.record_enabled, b.record_mode,
             b.practice_exam_id, b.identity_verification
      FROM students s
      JOIN batches b ON s.batch_id = b.id
      WHERE s.access_code = ?
    `, [access_code]);

    const student = result.rows[0];

    if (!student) {
      return res.status(404).json({ error: 'Invalid access code' });
    }

    if (student.status === 'submitted') {
      return res.status(400).json({ error: 'Exam already submitted' });
    }
    
    // Cho phép in_progress để resume exam (không block)

    const nowGMT7 = toGMT7(new Date());
    const startTime = toGMT7(new Date(student.start_time));
    const endTime = toGMT7(new Date(student.end_time));

    // Skip time check in development mode (USE_SQLITE=true)
    const isDevMode = USE_SQLITE || process.env.SKIP_TIME_CHECK === 'true';
    
    if (!isDevMode && (nowGMT7 < startTime || nowGMT7 > endTime)) {
      return res.status(400).json({ 
        error: 'Exam is not available at this time',
        scheduled: `${startTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} - ${endTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
      });
    }

    const emailsResult = await db.query(`
      SELECT email FROM students 
      WHERE batch_id = ? AND access_code = ?
    `, [student.batch_id, access_code]);

    // [C-4] Cấp student token (JWT ngắn hạn 4h) — không trả raw studentId dạng tin tưởng nữa
    const secret = process.env.JWT_SECRET!;
    // jti: định danh phiên riêng cho mỗi lần verify — dùng phát hiện dùng đồng thời nhiều client
    const jti = crypto.randomUUID();
    await db.query('UPDATE students SET active_jti = ? WHERE id = ?', [jti, student.id]);
    const studentToken = jwt.sign(
      { studentId: student.id, batchId: student.batch_id, jti } as StudentTokenPayload,
      secret,
      { expiresIn: '4h' }
    );

    // Chế độ ghi màn hình: 'none' | 'local' | 's3'. record_enabled cũ vẫn được suy ra để tương thích.
    const recordMode: string = student.record_mode || (student.record_enabled ? 's3' : 'none');
    const tenantIdentity = await currentIdentityConfig();
    const batchIdentityMode = normalizeIdentityMode(student.identity_verification);
    const identityMode = batchIdentityMode === 'photo' && tenantIdentity.mode === 'photo' ? 'photo' : 'off';
    const targetIdentityStatus = identityMode === 'off' ? 'not_required'
      : student.identity_status === 'verified' ? 'verified'
        : student.identity_status === 'captured' || student.identity_status === 'rejected' ? student.identity_status : 'pending';
    if (student.identity_status !== targetIdentityStatus) {
      await db.query('UPDATE students SET identity_status = ? WHERE id = ?', [targetIdentityStatus, student.id]);
    }

    // Với mode 'local': cấp password mã hóa zip (server sinh & giữ, học viên KHÔNG thấy).
    // Sinh 1 lần rồi tái dùng để resume-after-reload dùng lại đúng pass. Học viên chỉ
    // dùng ngầm để mã hóa file .zip; muốn xem lại video phải lấy pass từ trang Results.
    let recordingPassword: string | null = student.recording_password || null;
    if (recordMode === 'local' && !recordingPassword) {
      recordingPassword = crypto.randomBytes(24).toString('base64url');
      await db.query('UPDATE students SET recording_password = ? WHERE id = ?', [recordingPassword, student.id]);
    }

    res.json({
      valid: true,
      student_token: studentToken,
      access_code: student.access_code,
      emails: emailsResult.rows.map((s: any) => s.email),
      duration: student.duration,
      student_id: student.id, // giữ lại để hiển thị UI (không dùng cho auth)
      dev_mode: isDevMode,
      exam_start: startTime.toISOString(),
      exam_end: endTime.toISOString(),
      // Batch dạng Practice → frontend điều hướng /practice thay vì /exam
      exam_kind: student.practice_exam_id ? 'practice' : 'exam',
      record_enabled: !!student.record_enabled, // giữ để tương thích ngược
      record_mode: recordMode,
      // chỉ trả pass khi local — client dùng ngầm để mã hóa, không hiển thị
      recording_password: recordMode === 'local' ? recordingPassword : undefined,
      identity_mode: identityMode,
      identity_status: targetIdentityStatus,
      identity_retention_days: identityMode === 'photo' ? tenantIdentity.retentionDays : undefined,
    });
  } catch (error: any) {
    if (sendExamGuardError(res, error)) return;
    res.status(500).json({ error: error.message });
  }
});

router.post('/select-email', async (req: Request, res: Response) => {
  try {
    const { student_id, email } = req.body;

    const result = await db.query('SELECT * FROM students WHERE id = ? AND email = ?', [student_id, email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid student or email' });
    }

    res.json({ valid: true, student_id: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/identity/upload-url', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const mode = (await currentIdentityConfig()).mode;
    if (mode !== 'photo') return res.status(403).json({ error: 'Photo identity verification is not enabled.' });
    if (!isIdentityS3Configured()) return res.status(503).json({ error: 'Identity image storage is not configured.' });
    const contentType = req.body?.content_type;
    if (contentType !== 'image/jpeg') return res.status(400).json({ error: 'Identity images must be JPEG.' });
    const { studentId, batchId } = req.studentPayload!;
    const student = (await db.query(`SELECT s.identity_status, b.identity_verification
      FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ? AND s.batch_id = ?`, [studentId, batchId])).rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (normalizeIdentityMode(student.identity_verification) !== 'photo') {
      return res.status(403).json({ error: 'Photo identity verification is not required for this batch.' });
    }
    if (!['pending', 'rejected'].includes(student.identity_status)) {
      return res.status(409).json({ error: 'Identity images are already awaiting or have completed review.' });
    }
    const captureId = crypto.randomUUID();
    await db.query(`UPDATE students SET identity_status = 'pending', identity_capture_id = ?,
      identity_id_key = NULL, identity_face_key = NULL, identity_reviewed_by = NULL, identity_reviewed_at = NULL
      WHERE id = ? AND batch_id = ?`, [captureId, studentId, batchId]);
    const upload = await createIdentityUploadUrls({ batchId, studentId, captureId, contentType });
    return res.json({ id_url: upload.idUrl, face_url: upload.faceUrl, expires_seconds: 900 });
  } catch (error) {
    console.error('[Identity] Upload URL failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(500).json({ error: 'Unable to prepare identity upload.' });
  }
});

router.post('/identity/complete', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const mode = (await currentIdentityConfig()).mode;
    if (mode !== 'photo') return res.status(403).json({ error: 'Photo identity verification is not enabled.' });
    const { studentId, batchId } = req.studentPayload!;
    const student = (await db.query(`SELECT s.identity_status, s.identity_capture_id, b.identity_verification
      FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ? AND s.batch_id = ?`, [studentId, batchId])).rows[0];
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (normalizeIdentityMode(student.identity_verification) !== 'photo') {
      return res.status(403).json({ error: 'Photo identity verification is not required for this batch.' });
    }
    if (student.identity_status === 'verified') return res.status(409).json({ error: 'Identity was already verified.' });
    if (!student.identity_capture_id || student.identity_status !== 'pending') {
      return res.status(409).json({ error: 'No identity capture is ready to complete.' });
    }
    const claim = await db.query(`UPDATE students SET identity_status = 'captured'
      WHERE id = ? AND batch_id = ? AND identity_status = 'pending' AND identity_capture_id = ?`,
    [studentId, batchId, student.identity_capture_id]);
    if (claim.rowCount !== 1) return res.status(409).json({ error: 'Identity capture is already being finalized.' });
    let finalized;
    try {
      finalized = await finalizeIdentityObjects({ batchId, studentId, captureId: student.identity_capture_id });
      const stored = await db.query(
        `UPDATE students SET identity_status = 'captured', identity_id_key = ?, identity_face_key = ?,
         identity_score = NULL, identity_reviewed_by = NULL, identity_reviewed_at = NULL
         WHERE id = ? AND batch_id = ? AND identity_capture_id = ? AND identity_status = 'captured'`,
        [finalized.idKey, finalized.faceKey, studentId, batchId, student.identity_capture_id],
      );
      if (stored.rowCount !== 1) throw new Error('Identity capture changed while finalizing.');
    } catch (error) {
      await db.query(`UPDATE students SET identity_status = 'pending'
        WHERE id = ? AND batch_id = ? AND identity_capture_id = ? AND identity_id_key IS NULL AND identity_face_key IS NULL`,
      [studentId, batchId, student.identity_capture_id]).catch(() => undefined);
      throw error;
    }
    return res.json({ status: 'captured' });
  } catch (error) {
    console.error('[Identity] Upload completion failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(422).json({ error: 'Both identity images must finish uploading.' });
  }
});

router.get('/identity/status', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { studentId, batchId } = req.studentPayload!;
    const tenant = await currentIdentityConfig();
    const row = (await db.query(`SELECT s.identity_status, b.identity_verification
      FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ? AND s.batch_id = ?`, [studentId, batchId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Student not found.' });
    const batchMode = normalizeIdentityMode(row.identity_verification);
    const mode = batchMode === 'photo' && tenant.mode === 'photo' ? 'photo' : 'off';
    return res.json({
      mode,
      status: mode === 'off' ? 'not_required' : row.identity_status,
      retention_days: mode === 'photo' ? tenant.retentionDays : undefined,
    });
  } catch (error) {
    console.error('[Identity] Status failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(500).json({ error: 'Unable to load identity status.' });
  }
});

router.post('/exam/start', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    
    const student_id = req.studentPayload!.studentId;
    if (!(await requireStudentIdentity(student_id, res))) return;
    const startedExam = await startExamAtomically(student_id);
    const startedAt = (await db.query('SELECT exam_started_at FROM students WHERE id = ?', [student_id])).rows[0]?.exam_started_at;
    await enqueueUsageEvent(`exam-start:${student_id}`, 'exams_started', 1, new Date(startedAt));
    return res.json(startedExam);

    /* Legacy implementation retained temporarily below for source compatibility; unreachable after atomic start. */
    console.log('[startExam] student_id:', student_id);

    const studentResult = await db.query(
      'SELECT s.*, b.duration, b.end_time FROM students s JOIN batches b ON s.batch_id = b.id WHERE s.id = ?',
      [student_id]
    );
    const student = studentResult.rows[0];
    // Never log the student row: it contains recording credentials and private identity object keys.

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    console.log('[startExam] student.status:', student.status);
    
    if (student.status === 'submitted') {
      return res.status(400).json({ error: 'Exam already submitted' });
    }

    if (student.status === 'in_progress') {
      const existingQuestions = await db.query(
        'SELECT COUNT(*) as count FROM exam_questions WHERE student_id = ?',
        [student_id]
      );
      if (existingQuestions.rows[0].count === 0) {
        console.log('[startExam] Resume but no questions, generating...');
        // Fall through to generate questions below
      } else {
        console.log('[startExam] Resume exam for student in_progress, questions:', existingQuestions.rows[0].count);
        // Xoá disconnected_at khi resume thành công
        await db.query('UPDATE students SET disconnected_at = NULL WHERE id = ?', [student_id]);
        return res.json({ success: true, questions_count: existingQuestions.rows[0].count, resume: true });
      }
    } else {
      // Auto-reset: Xóa exam_questions cũ nếu status = pending (phòng trường hợp có dữ liệu cũ)
      if (student.status === 'pending') {
        await db.query('DELETE FROM exam_questions WHERE student_id = ?', [student_id]);
        console.log('[startExam] Auto-reset: Xóa exam_questions cũ (nếu có)');
      }
    }

    const batchResult = await db.query('SELECT blueprint, exam_type FROM batches WHERE id = ?', [student.batch_id]);
    const batch = batchResult.rows[0];
    const { blueprintMode, items: blueprintItems } = parseBlueprintCompat(batch?.blueprint);
    const examType = batch?.exam_type === 'quiz' ? 'quiz' : 'essay';

    // Batch quiz chỉ lấy câu trắc nghiệm; batch essay chỉ lấy câu tự luận/coding.
    // Tránh lôi nhầm câu khác loại khi một module chứa lẫn cả hai (blueprint mode 'module').
    const typeFilterSql = examType === 'quiz'
      ? `AND type IN ('SingleChoice', 'MultipleChoice')`
      : `AND type NOT IN ('SingleChoice', 'MultipleChoice')`;

    // Mỗi câu kèm type + options (để sinh thứ tự đáp án xáo cho câu quiz)
    const picked: { id: string; type: string; options: string | null }[] = [];

    for (const item of blueprintItems) {
      for (const level of ['Easy', 'Medium', 'Hard'] as const) {
        const count = item[level.toLowerCase() as 'easy' | 'medium' | 'hard'];
        if (count > 0) {
          const blueprintTypeSql = blueprintMode === 'type' ? 'AND LOWER(type) = LOWER(?)' : '';
          const queryParams = blueprintMode === 'type'
            ? [item.module, level, item.type, count]
            : [item.module, level, count];
          const availableResult = await db.query(`
            SELECT id, type, options FROM question_bank
            WHERE LOWER(module) = LOWER(?) AND LOWER(level) = LOWER(?) ${blueprintTypeSql} ${typeFilterSql}
            ORDER BY RANDOM()
            LIMIT ?
          `, queryParams);

          for (const q of availableResult.rows) {
            picked.push({ id: q.id, type: q.type, options: q.options ?? null });
          }
        }
      }
    }

    // Fisher–Yates: xáo thứ tự CÂU cho riêng học viên này
    for (let i = picked.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }

    for (let i = 0; i < picked.length; i++) {
      const q = picked[i];
      // Câu quiz (Single/Multiple): xáo thứ tự các key option và persist để chấm/F5 ổn định
      let optionOrder: string | null = null;
      if ((q.type === 'SingleChoice' || q.type === 'MultipleChoice') && q.options) {
        try {
          const opts = JSON.parse(q.options) as { key: string }[];
          const keys = opts.map((o) => o.key);
          for (let a = keys.length - 1; a > 0; a--) {
            const b = crypto.randomInt(a + 1);
            [keys[a], keys[b]] = [keys[b], keys[a]];
          }
          optionOrder = JSON.stringify(keys);
        } catch (_) { /* options lỗi → để NULL, client hiển thị theo thứ tự gốc */ }
      }
      await db.query(`
        INSERT INTO exam_questions (student_id, question_id, question_order, option_order)
        VALUES (?, ?, ?, ?)
      `, [student_id, q.id, i + 1, optionOrder]);
    }

    // Ghi thời điểm bắt đầu và deadline (chỉ set khi chưa có)
    const durationSeconds = (student.duration || 30) * 60;
    const now = new Date();
    const deadline = computeExamDeadline(now, durationSeconds / 60, new Date(student.end_time));
    await db.query(
      "UPDATE students SET status = 'in_progress', exam_started_at = ?, exam_deadline = ?, disconnected_at = NULL WHERE id = ?",
      [now.toISOString(), deadline.toISOString(), student_id]
    );

    res.json({ success: true, questions_count: picked.length });
  } catch (error: any) {
    if (sendExamGuardError(res, error)) return;
    res.status(500).json({ error: error.message });
  }
});


router.get('/exam/questions', studentAuthMiddleware, sessionTracker, async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    // [C-4] Đọc studentId từ token đã xác thực, không tin x-student-id header
    const studentId = req.studentPayload!.studentId.toString();
    if (!(await requireStudentIdentity(parseInt(studentId), res))) return;

    // === SERVER-SIDE TIMER GUARD ===
    const studentResult = await db.query(`
      SELECT s.status, s.exam_deadline, s.disconnected_at, b.duration
      FROM students s
      JOIN batches b ON s.batch_id = b.id
      WHERE s.id = ?
    `, [parseInt(studentId)]);
    const student = studentResult.rows[0];

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (student.status === 'submitted') {
      return res.status(410).json({ 
        error: 'Exam already submitted',
        reason: 'submitted'
      });
    }

    const now = new Date();

    // Nếu học viên mới bắt đầu truy cập bài thi lần đầu (status = pending)
    if (student.status === 'pending') {
      return res.json({ questions: [], time_remaining: null });
    }


    // Kiểm tra deadline đã qua chưa
    if (student.exam_deadline) {
      const deadline = new Date(student.exam_deadline);
      if (now >= deadline) {
        console.log('[getQuestions] Deadline passed, auto-submitting student:', studentId);
        await submitExamAtomically(parseInt(studentId), 'timeout');
        return res.status(410).json({
          error: 'Time is up. Your exam has been automatically submitted.',
          reason: 'timeout'
        });
      }
    }

    // Kiểm tra thời gian vắng mặt (disconnected > 2 phút)
    const DISCONNECT_GRACE_SECONDS = 120; // 2 phút
    if (student.disconnected_at) {
      const disconnectedAt = new Date(student.disconnected_at);
      const absentSeconds = (now.getTime() - disconnectedAt.getTime()) / 1000;
      if (absentSeconds > DISCONNECT_GRACE_SECONDS) {
        console.log('[getQuestions] Student absent too long (%ds), auto-submitting:', Math.round(absentSeconds));
        await submitExamAtomically(parseInt(studentId), 'absent_too_long');
        await db.query('UPDATE students SET disconnected_at = NULL WHERE id = ?', [parseInt(studentId)]);
        return res.status(410).json({
          error: 'You were absent for more than 2 minutes. Your exam has been automatically submitted.',
          reason: 'absent_too_long'
        });
      }
      // Trong grace period: xóa disconnected_at (học viên đã quay lại đúng hạn)
      await db.query('UPDATE students SET disconnected_at = NULL WHERE id = ?', [parseInt(studentId)]);
    }

    // === CONCURRENT SESSION GUARD ===
    // Endpoint này được poll đều đặn nên là nơi tự nhiên để phát hiện phiên song song,
    // kể cả khi client kia không gửi violation. Auto-lock khi có chồng lấn thời gian.
    const autoLocked = await enforceConcurrentSession(parseInt(studentId), req.studentPayload!.batchId);
    if (autoLocked) {
      return res.status(410).json({
        error: 'Multiple concurrent sessions detected. Your exam has been automatically submitted.',
        reason: 'concurrent_session'
      });
    }

    // Tính time_remaining từ server
    let time_remaining: number | null = null;
    if (student.exam_deadline) {
      const deadline = new Date(student.exam_deadline);
      time_remaining = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 1000));
    }
    // === END GUARD ===

    // Lưu ý bảo mật: KHÔNG select q.correct_answers — đáp án đúng không bao giờ rời server.
    const result = await db.query(`
      SELECT eq.question_order, eq.answer, eq.option_order, q.id, q.type, q.level, q.module, q.question_sample, q.options
      FROM exam_questions eq
      JOIN question_bank q ON eq.question_id = q.id
        AND COALESCE(eq.question_group, '') = COALESCE(q.question_group, '')
      WHERE eq.student_id = ?
      ORDER BY eq.question_order
    `, [parseInt(studentId)]);

    const questions = result.rows.map((q: any) => {
      const isQuiz = q.type === 'SingleChoice' || q.type === 'MultipleChoice';
      let options: { key: string; text: string }[] | undefined;
      if (isQuiz && q.options) {
        try {
          const parsed = JSON.parse(q.options) as { key: string; text: string }[];
          const order: string[] | null = q.option_order ? JSON.parse(q.option_order) : null;
          if (order && order.length) {
            const byKey = new Map(parsed.map((o) => [o.key, o]));
            options = order.map((k) => byKey.get(k)).filter(Boolean) as { key: string; text: string }[];
          } else {
            options = parsed;
          }
        } catch (_) { options = undefined; }
      }
      return {
        question_order: q.question_order,
        id: q.id,
        type: q.type,
        level: q.level,
        module: q.module,
        question_sample: q.question_sample,
        answer: q.answer || '',
        ...(options ? { options } : {}),
      };
    });

    res.json({ questions, time_remaining });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// Endpoint nhận beacon khi học viên tắt trình duyệt / đóng tab
// [C-4] sendBeacon không hỗ trợ custom headers nên token được gửi trong body
router.post('/exam/disconnect', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.studentPayload!.studentId.toString();

    const studentResult = await db.query(
      'SELECT status FROM students WHERE id = ?',
      [parseInt(studentId)]
    );
    const student = studentResult.rows[0];

    // Chỉ ghi disconnected_at nếu đang in_progress
    if (student && student.status === 'in_progress') {
      await db.query(
        'UPDATE students SET disconnected_at = ? WHERE id = ?',
        [new Date().toISOString(), parseInt(studentId)]
      );
      console.log('[disconnect] Ghi disconnected_at cho student:', studentId);
    }

    res.status(204).send();
  } catch (error: any) {
    // Không trả lỗi để không block beacon
    res.status(204).send();
  }
});

router.post('/exam/answer', studentAuthMiddleware, sessionTracker, async (req: Request, res: Response) => {
  try {
    // [C-4] studentId từ token đã xác thực
    const studentId = req.studentPayload!.studentId.toString();

    const questionOrder = Number(req.body?.question_order);
    let answer = req.body?.answer;
    if (!Number.isInteger(questionOrder) || questionOrder <= 0 || typeof answer !== 'string') {
      return res.status(400).json({ error: 'Invalid answer payload' });
    }
    if (answer.length > 100_000) return res.status(413).json({ error: 'Answer is too large' });

    // [SEC] Không nhận answer sau khi đã nộp hoặc quá deadline.
    // Trước đây /answer chỉ buffer mù → sau khi bị khóa/auto-submit vẫn ghi đè được đáp án.
    const assigned = (await db.query(`
      SELECT q.type, q.options
      FROM exam_questions eq JOIN question_bank q ON q.id = eq.question_id
      WHERE eq.student_id = ? AND eq.question_order = ?
    `, [parseInt(studentId), questionOrder])).rows[0];
    if (!assigned) return res.status(404).json({ error: 'Question is not assigned to this student' });

    if (assigned.type === 'SingleChoice' || assigned.type === 'MultipleChoice') {
      let selected: string[];
      try { selected = JSON.parse(answer); } catch { return res.status(400).json({ error: 'Invalid quiz answer' }); }
      if (!Array.isArray(selected) || selected.some((key) => typeof key !== 'string')) {
        return res.status(400).json({ error: 'Invalid quiz answer' });
      }
      const allowed = new Set<string>();
      try { for (const option of JSON.parse(assigned.options || '[]')) allowed.add(option.key); } catch {}
      selected = [...new Set(selected)];
      if (selected.some((key) => !allowed.has(key)) || (assigned.type === 'SingleChoice' && selected.length > 1)) {
        return res.status(400).json({ error: 'Invalid quiz option' });
      }
      answer = JSON.stringify(selected);
    }

    // Lưu vào buffer trước
    const saved = await db.query(`
      UPDATE exam_questions
      SET answer = ?
      WHERE student_id = ? AND question_order = ?
        AND EXISTS (
          SELECT 1 FROM students s
          WHERE s.id = exam_questions.student_id
            AND s.status = 'in_progress'
            AND s.exam_deadline IS NOT NULL
            AND s.exam_deadline > CURRENT_TIMESTAMP
        )
    `, [answer, parseInt(studentId), questionOrder]);
    if (saved.rowCount !== 1) {
      const current = (await db.query('SELECT status, exam_deadline FROM students WHERE id = ?', [parseInt(studentId)])).rows[0];
      if (current?.status === 'in_progress' && current.exam_deadline && new Date() >= new Date(current.exam_deadline)) {
        await submitExamAtomically(parseInt(studentId), 'timeout');
        return res.status(410).json({ error: 'Deadline passed', reason: 'timeout' });
      }
      return res.status(410).json({ error: 'Exam is no longer accepting answers', reason: 'submitted_or_timeout' });
    }

    res.json({ success: true, persisted: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/exam/flush', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    // [C-4] studentId từ token xác thực
    // flush toàn bộ buffer (bao gồm cả của student hiện tại) — ok vì chỉ admin-triggered
    await cache.flushAnswers();

    res.json({ success: true, flushed: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/exam/submit', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    // [C-4] studentId từ token đã xác thực
    const studentId = req.studentPayload!.studentId.toString();

    // [SEC] Idempotent: nếu đã submitted thì trả OK ngay, không flush/queue lại
    // (tránh re-queue chấm điểm trùng khi client gọi submit nhiều lần).
    const result = await submitExamAtomically(parseInt(studentId), 'manual', { requireCompleteRecording: true });
    res.json({ success: true, already: result.already, message: 'Exam submitted. Results will be available shortly.' });
  } catch (error: any) {
    console.error('Submit error:', error);
    if (error?.code === 'RECORDING_INCOMPLETE') {
      return res.status(409).json({ error: error.message, reason: 'recording_incomplete' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/violation', studentAuthMiddleware, sessionTracker, async (req: Request, res: Response) => {
  try {
    // [C-4] studentId từ token đã xác thực
    const studentId = req.studentPayload!.studentId.toString();
    const batchId = req.studentPayload!.batchId;

    // [SEC] Kiểm tra phiên đồng thời trước — nếu chồng lấn thời gian, backend auto-lock ngay.
    const autoLocked = await enforceConcurrentSession(parseInt(studentId), batchId);
    if (autoLocked) {
      return res.json({ violation_count: 0, total_violations: 0, locked: true, reason: 'concurrent_session' });
    }

    const { type, content_preview, text_length, question_id, metadata } = req.body;

    // Validate violation type — chỉ chấp nhận các loại hợp lệ.
    // suspicious_paste & focus_lost giờ là lockable (không còn log-only) —
    // suspicious_paste dùng threshold 300 ký tự + focus_lost đo qua blur/focus
    // với đệm 3s nên đủ tin cậy để tính vào ngưỡng khóa như mọi type khác.
    const validTypes = [
      'tab_switch',
      'fullscreen_exit',
      'copy_attempt',
      'cut_attempt',
      'paste_attempt',
      'devtools_open',
      'view_source',
      'extension_panel',
      'screenshot_attempt',  // phím PrintScreen / PrtSc
      'print_attempt',       // Ctrl+P hoặc browser print dialog
      'suspicious_paste',    // Thâm nhập text lớn bất thường qua Maccy/Win+V Accessibility API
      'focus_lost',          // Mất focus cửa sổ (Split View / mở app khác trên macOS)
      'recording_stopped',   // Thí sinh tự dừng chia sẻ màn hình giữa bài (getDisplayMedia track ended)
      'rapid_text_insertion',
      'multiple_display_detected',
      'concurrent_session',  // dùng đồng thời nhiều client/IP — server tự phát hiện & ghi
    ];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid violation type' });
    }

    const forensicOnly = type === 'rapid_text_insertion' || type === 'multiple_display_detected';
    const existingResult = await db.query('SELECT * FROM violations WHERE student_id = ? AND type = ?', [parseInt(studentId), type]);

    if (!forensicOnly && existingResult.rows.length === 0) {
      await db.query('INSERT INTO violations (student_id, type, count) VALUES (?, ?, 1)', [parseInt(studentId), type]);
    } else if (!forensicOnly) {
      await db.query('UPDATE violations SET count = count + 1 WHERE id = ?', [existingResult.rows[0].id]);
    }

    // Anti-Cheat forensic log: ghi từng lần vi phạm (append-only) để admin review.
    // content_preview chỉ lưu tối đa 500 ký tự đầu, chỉ có với suspicious_paste.
    // QUAN TRỌNG: forensic log là phụ trợ — KHÔNG được để lỗi ghi log (vd bảng chưa
    // tồn tại trên DB cũ) làm hỏng logic lock/auto-submit của MỌI loại vi phạm.
    // Vì vậy bọc riêng try/catch, nuốt lỗi và chỉ log ra console.
    try {
      const preview = typeof content_preview === 'string' ? content_preview.slice(0, 500) : null;
      const textLen = Number.isFinite(text_length) ? Math.trunc(text_length) : null;
      const qId = typeof question_id === 'string' ? question_id : null;
      const metadataJson = metadata && typeof metadata === 'object'
        ? JSON.stringify(metadata).slice(0, 2000)
        : null;
      await db.query(
        'INSERT INTO violation_events (student_id, batch_id, type, text_length, content_preview, question_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [parseInt(studentId), batchId, type, textLen, preview, qId, metadataJson]
      );
    } catch (logErr: any) {
      console.error('[violation] forensic log insert failed (non-fatal):', logErr?.message);
    }

    const totalResult = await db.query('SELECT SUM(count) as total FROM violations WHERE student_id = ?', [parseInt(studentId)]);
    const total = parseInt(totalResult.rows[0]?.total) || 0;

    const currentResult = await db.query('SELECT count FROM violations WHERE student_id = ? AND type = ?', [parseInt(studentId), type]);
    const currentCount = parseInt(currentResult.rows[0]?.count) || 0;

    // recording_stopped: dừng chia sẻ màn hình = cố ý trốn giám sát → khóa NGAY lần đầu.
    // Các type khác: khóa khi 1 type đạt >= 2 lần HOẶC tổng vi phạm >= 2 (mọi type đều tính).
    const locked = !forensicOnly && (type === 'recording_stopped' || currentCount >= 2 || total >= 2);

    // [SEC] Cưỡng chế nộp bài ở BACKEND khi đạt ngưỡng khóa — không phụ thuộc frontend auto-submit.
    // Trước đây chỉ trả cờ `locked` cho client; một client bị điều khiển (automation) có thể phớt lờ
    // response và tiếp tục làm bài. Giờ server tự set status='submitted' + chấm điểm ngay.
    if (locked) {
      try {
        const statusRow = await db.query('SELECT status FROM students WHERE id = ?', [parseInt(studentId)]);
        if (statusRow.rows[0]?.status === 'in_progress') {
          await submitExamAtomically(
            parseInt(studentId),
            type === 'recording_stopped' ? 'recording_stopped' : 'violation'
          );
          console.log('[violation] Auto-submitted (locked) student:', studentId, 'type:', type);
        }
      } catch (lockErr: any) {
        console.error('[violation] auto-submit on lock failed:', lockErr?.message);
        throw lockErr;
      }
    }

    res.json({
      violation_count: currentCount,
      total_violations: total,
      locked,
      forensic_only: forensicOnly,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cấp presigned PUT URL để client upload 1 phần video record thẳng lên S3.
// batchId/studentId lấy từ JWT — client KHÔNG thể chỉ định để ghi đè video người khác.
router.post('/exam/recording-url', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isS3Configured()) {
      return res.status(503).json({ error: 'S3 not configured' });
    }

    const studentId = req.studentPayload!.studentId;
    if (!(await requireStudentIdentity(studentId, res))) return;
    const batchId = req.studentPayload!.batchId;

    // Chỉ cấp URL khi batch ở mode 's3' (chốt chặn server-side, tránh mod/ai lách).
    // Mode 'local' ghi ra máy học viên, không dùng S3 → không cấp URL.
    const batchRes = await db.query(`
      SELECT b.record_mode, b.record_enabled, s.status, s.exam_deadline, s.submitted_at, s.recording_incomplete
      FROM batches b JOIN students s ON s.batch_id = b.id
      WHERE b.id = ? AND s.id = ?
    `, [batchId, studentId]);
    const batchMode = batchRes.rows[0]?.record_mode || (batchRes.rows[0]?.record_enabled ? 's3' : 'none');
    if (batchMode !== 's3') {
      return res.status(403).json({ error: 'S3 recording not enabled for this batch' });
    }
    const submittedRecordingGrace = batchRes.rows[0]?.status === 'submitted'
      && batchRes.rows[0]?.recording_incomplete
      && batchRes.rows[0]?.submitted_at
      && Date.now() - new Date(batchRes.rows[0].submitted_at).getTime() <= 15 * 60_000;
    if (batchRes.rows[0]?.status !== 'in_progress' && !submittedRecordingGrace) {
      return res.status(409).json({ error: 'Exam is not in progress' });
    }
    if (!submittedRecordingGrace && batchRes.rows[0]?.exam_deadline && new Date() >= new Date(batchRes.rows[0].exam_deadline)) {
      return res.status(410).json({ error: 'Deadline passed', reason: 'timeout' });
    }

    const { partIndex, contentType } = req.body;

    const idx = Number(partIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      return res.status(400).json({ error: 'Invalid partIndex' });
    }
    const existingPart = await db.query(
      'SELECT id FROM recording_parts WHERE student_id = ? AND part_index = ?',
      [studentId, idx]
    );
    if (existingPart.rows.length > 0) {
      return res.status(409).json({ error: 'Recording part has already been finalized' });
    }

    const { url, key } = await createRecordingUploadUrl({
      batchId,
      studentId,
      partIndex: idx,
      contentType: typeof contentType === 'string' ? contentType : undefined,
    });

    res.json({ url, key });
  } catch (error: any) {
    console.error('[recording-url] failed:', error?.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/exam/recording-complete', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.studentPayload!.studentId;
    const batchId = req.studentPayload!.batchId;
    const partIndex = Number(req.body?.partIndex);
    if (!Number.isInteger(partIndex) || partIndex < 0) {
      return res.status(400).json({ error: 'Invalid recording part metadata' });
    }
    const exam = (await db.query(`
      SELECT s.status, s.submitted_at, s.recording_incomplete, b.record_mode, b.record_enabled
      FROM students s JOIN batches b ON b.id = s.batch_id
      WHERE s.id = ? AND b.id = ?
    `, [studentId, batchId])).rows[0];
    const recordMode = exam?.record_mode || (exam?.record_enabled ? 's3' : 'none');
    const submittedRecordingGrace = exam?.status === 'submitted' && exam?.recording_incomplete && exam?.submitted_at
      && Date.now() - new Date(exam.submitted_at).getTime() <= 15 * 60_000;
    if (!exam || (exam.status !== 'in_progress' && !submittedRecordingGrace)) return res.status(409).json({ error: 'Exam is not accepting recording parts' });
    if (recordMode !== 's3') return res.status(403).json({ error: 'S3 recording is not enabled' });
    const objectKey = `recordings/${batchId}/${studentId}/part${String(partIndex).padStart(3, '0')}.webm`;
    const { byteSize } = await inspectRecordingObject(objectKey);
    if (byteSize <= 0) return res.status(422).json({ error: 'Uploaded recording part is empty' });
    await db.query(`
      INSERT INTO recording_parts (student_id, batch_id, part_index, object_key, byte_size, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, part_index) DO NOTHING
    `, [studentId, batchId, partIndex, objectKey, Math.trunc(byteSize), new Date().toISOString()]);
    res.json({ success: true, key: objectKey });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/exam/recording-finalize', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.studentPayload!.studentId;
    const batchId = req.studentPayload!.batchId;
    const finalPartIndex = Number(req.body?.finalPartIndex);
    if (!Number.isInteger(finalPartIndex) || finalPartIndex < 0 || finalPartIndex > 1000) {
      return res.status(400).json({ error: 'Invalid finalPartIndex' });
    }

    await db.withTransaction(async (tx) => {
      const row = (await tx.query(`
        SELECT s.status, s.submitted_at, s.recording_incomplete,
               s.exam_started_at, s.recording_finalized_at, s.recording_final_part_index,
               b.record_mode, b.record_enabled
        FROM students s JOIN batches b ON b.id = s.batch_id
        WHERE s.id = ?${USE_SQLITE ? '' : ' FOR UPDATE'}
      `, [studentId])).rows[0];
      const submittedRecordingGrace = row?.status === 'submitted' && row?.recording_incomplete && row?.submitted_at
        && Date.now() - new Date(row.submitted_at).getTime() <= 15 * 60_000;
      if (!row || (row.status !== 'in_progress' && !submittedRecordingGrace)) {
        throw Object.assign(new Error('Exam is not accepting recording finalization'), { code: 'NOT_IN_PROGRESS' });
      }
      const mode = row.record_mode || (row.record_enabled ? 's3' : 'none');
      if (mode !== 's3') throw Object.assign(new Error('S3 recording is not enabled'), { code: 'BAD_RECORD_MODE' });
      if (row.recording_finalized_at) {
        if (Number(row.recording_final_part_index) !== finalPartIndex) {
          throw Object.assign(new Error('Recording was already finalized with a different manifest'), { code: 'MANIFEST_CONFLICT' });
        }
        const minutes = Math.max(1, (new Date(row.recording_finalized_at).getTime() - new Date(row.exam_started_at).getTime()) / 60_000);
        await tx.query(
          `INSERT INTO usage_outbox (event_key, metric, amount, occurred_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (event_key) DO NOTHING`,
          [`recording:${studentId}`, 'recording_minutes', minutes, new Date(row.recording_finalized_at).toISOString()],
        );
        return;
      }

      const parts = await tx.query(
        'SELECT part_index FROM recording_parts WHERE student_id = ? ORDER BY part_index',
        [studentId]
      );
      if (parts.rows.length !== finalPartIndex + 1 || parts.rows.some((part, index) => Number(part.part_index) !== index)) {
        throw Object.assign(new Error('Recording parts are incomplete'), { code: 'RECORDING_INCOMPLETE' });
      }
      await tx.query('UPDATE recording_parts SET is_final = TRUE WHERE student_id = ? AND part_index = ?', [studentId, finalPartIndex]);
      const finalizedAt = new Date();
      await tx.query(
        'UPDATE students SET recording_finalized_at = ?, recording_final_part_index = ?, recording_incomplete = FALSE WHERE id = ?',
        [finalizedAt.toISOString(), finalPartIndex, studentId]
      );
      const minutes = Math.max(1, (finalizedAt.getTime() - new Date(row.exam_started_at).getTime()) / 60_000);
      await tx.query(
        `INSERT INTO usage_outbox (event_key, metric, amount, occurred_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (event_key) DO NOTHING`,
        [`recording:${studentId}`, 'recording_minutes', minutes, finalizedAt.toISOString()],
      );
    });
    res.json({ success: true, finalPartIndex });
  } catch (error: any) {
    const status = error?.code === 'RECORDING_INCOMPLETE' ? 409
      : error?.code === 'MANIFEST_CONFLICT' ? 409
      : error?.code === 'NOT_IN_PROGRESS' ? 409
      : error?.code === 'BAD_RECORD_MODE' ? 403 : 500;
    res.status(status).json({ error: error.message, reason: error?.code?.toLowerCase() });
  }
});


// =============================================
// PRACTICE EXAM — Bài thi practice import từ .docx, 1 bài làm duy nhất
// Tái dùng students/violations/disconnect; bài làm lưu ở practice_submissions.
// =============================================

// GET /api/student/practice — Nội dung đề + bài làm hiện tại + time_remaining
// Tự start (set deadline) ở lần gọi đầu; guard timeout/vắng mặt giống /exam/questions.
// Compiler requests are measured after an accepted run and never quota-blocked.
router.post('/run', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    if (process.env.ENABLE_SERVER_CODE_RUN?.trim().toLowerCase() === 'false') {
      return res.status(503).json({ error: 'Server code execution is disabled.' });
    }
    const studentId = req.studentPayload!.studentId;
    const eventId = String(req.body?.event_id || '').trim();
    if (!/^[A-Za-z0-9_.-]{8,80}$/.test(eventId)) {
      return res.status(400).json({ error: 'A stable event_id is required.' });
    }
    const practice = (await db.query(`
      SELECT s.status FROM students s JOIN batches b ON b.id = s.batch_id
      WHERE s.id = ? AND b.practice_exam_id IS NOT NULL
    `, [studentId])).rows[0];
    if (!practice || practice.status !== 'in_progress') {
      return res.status(409).json({ error: 'Practice exam is not in progress.' });
    }
    const language = String(req.body?.language || '').trim().toLowerCase();
    const code = String(req.body?.code || '');
    const stdin = String(req.body?.stdin || '');
    const result = getPracticeCompilerMode() === 'lambda'
      ? await runCodeWithLambda(studentId, language, code, stdin)
      : await runCode(studentId, language, code, stdin);
    if (result.status === 200) {
      await enqueueUsageEvent(`code-run:${studentId}:${eventId}`, 'code_runs');
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[CodeRun] Request failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(500).json({ error: 'Unable to run code.' });
  }
});

router.post('/usage/code-run', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.studentPayload!.studentId;
    const eventId = String(req.body?.event_id || '').trim();
    if (!/^[A-Za-z0-9_.-]{8,80}$/.test(eventId)) return res.status(400).json({ error: 'A stable event_id is required.' });
    const practice = (await db.query(`
      SELECT s.status FROM students s JOIN batches b ON b.id = s.batch_id
      WHERE s.id = ? AND b.practice_exam_id IS NOT NULL
    `, [studentId])).rows[0];
    if (!practice || practice.status !== 'in_progress') return res.status(409).json({ error: 'Practice exam is not in progress.' });
    await enqueueUsageEvent(`code-run:${studentId}:${eventId}`, 'code_runs');
    return res.status(202).json({ accepted: true });
  } catch (error) {
    console.error('[Usage] Local code-run enqueue failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(500).json({ error: 'Unable to record code run.' });
  }
});

router.get('/practice', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const studentId = req.studentPayload!.studentId;
    if (!(await requireStudentIdentity(studentId, res))) return;

    const studentResult = await db.query(`
      SELECT s.status, s.exam_started_at, s.exam_deadline, s.disconnected_at, b.duration, b.practice_exam_id
      FROM students s
      JOIN batches b ON s.batch_id = b.id
      WHERE s.id = ?
    `, [studentId]);
    const student = studentResult.rows[0];

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    if (!student.practice_exam_id) {
      return res.status(400).json({ error: 'This batch is not a practice batch' });
    }
    if (student.status === 'submitted') {
      return res.status(410).json({ error: 'Exam already submitted', reason: 'submitted' });
    }

    const now = new Date();

    // Lần đầu truy cập: start bài, set deadline, tạo sẵn dòng bài làm
    if (student.status === 'pending') {
      const durationSeconds = (student.duration || 30) * 60;
      const deadline = new Date(now.getTime() + durationSeconds * 1000);
      await db.query(
        "UPDATE students SET status = 'in_progress', exam_started_at = ?, exam_deadline = ?, disconnected_at = NULL WHERE id = ?",
        [now.toISOString(), deadline.toISOString(), studentId]
      );
      student.status = 'in_progress';
      student.exam_started_at = now;
      student.exam_deadline = deadline;
    }
    await enqueueUsageEvent(`exam-start:${studentId}`, 'exams_started', 1, new Date(student.exam_started_at));

    // Đảm bảo luôn có dòng practice_submissions cho học viên này
    const subResult = await db.query('SELECT * FROM practice_submissions WHERE student_id = ?', [studentId]);
    let submission = subResult.rows[0];
    if (!submission) {
      await db.query(
        'INSERT INTO practice_submissions (student_id, practice_exam_id) VALUES (?, ?)',
        [studentId, student.practice_exam_id]
      );
      submission = { answer: '' };
    }

    const autoSubmitPractice = async () => {
      await db.query("UPDATE students SET status = 'submitted', disconnected_at = NULL WHERE id = ?", [studentId]);
      const sub = await db.query('SELECT id FROM practice_submissions WHERE student_id = ?', [studentId]);
      if (sub.rows[0]?.id) {
        cache.addToQueue(sub.rows[0].id, studentId, 'practice');
      }
    };

    // Guard: hết giờ
    if (student.exam_deadline) {
      const deadline = new Date(student.exam_deadline);
      if (now >= deadline) {
        console.log('[getPractice] Deadline passed, auto-submitting student:', studentId);
        await autoSubmitPractice();
        return res.status(410).json({
          error: 'Time is up. Your exam has been automatically submitted.',
          reason: 'timeout'
        });
      }
    }

    // Guard: vắng mặt quá 2 phút
    const DISCONNECT_GRACE_SECONDS = 120;
    if (student.disconnected_at) {
      const absentSeconds = (now.getTime() - new Date(student.disconnected_at).getTime()) / 1000;
      if (absentSeconds > DISCONNECT_GRACE_SECONDS) {
        console.log('[getPractice] Student absent too long (%ds), auto-submitting:', Math.round(absentSeconds));
        await autoSubmitPractice();
        return res.status(410).json({
          error: 'You were absent for more than 2 minutes. Your exam has been automatically submitted.',
          reason: 'absent_too_long'
        });
      }
      await db.query('UPDATE students SET disconnected_at = NULL WHERE id = ?', [studentId]);
    }

    let time_remaining: number | null = null;
    if (student.exam_deadline) {
      time_remaining = Math.max(0, Math.floor((new Date(student.exam_deadline).getTime() - now.getTime()) / 1000));
    }

    const practiceResult = await db.query(
      'SELECT id, name, content_html FROM practice_exams WHERE id = ?',
      [student.practice_exam_id]
    );
    const practice = practiceResult.rows[0];
    if (!practice) {
      return res.status(404).json({ error: 'Practice exam not found' });
    }

    res.json({
      practice: { id: practice.id, name: practice.name, content_html: practice.content_html },
      answer: submission.answer || '',
      time_remaining,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/student/practice/answer — Lưu bài làm (client debounce 2s, ghi thẳng DB
// vì mỗi học viên chỉ có 1 bài làm duy nhất, không cần buffer như exam nhiều câu)
router.post('/practice/answer', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.studentPayload!.studentId;
    const { answer } = req.body;

    const result = await db.query(
      'UPDATE practice_submissions SET answer = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?',
      [answer ?? '', studentId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No practice submission found. Load the exam first.' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/student/practice/submit — Nộp bài, đưa vào queue chấm AI
router.post('/practice/submit', studentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const studentId = req.studentPayload!.studentId;

    await db.query("UPDATE students SET status = 'submitted' WHERE id = ?", [studentId]);

    const subResult = await db.query('SELECT id FROM practice_submissions WHERE student_id = ?', [studentId]);
    if (subResult.rows[0]?.id) {
      cache.addToQueue(subResult.rows[0].id, studentId, 'practice');
    }

    res.json({ success: true, message: 'Practice exam submitted. Results will be available shortly.' });
  } catch (error: any) {
    console.error('Practice submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
