"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const postgres_js_1 = __importDefault(require("../db/postgres.js"));
const string_js_1 = require("../../utils/string.js");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.post('/questions/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        const validLevels = ['Easy', 'Medium', 'Hard'];
        const validTypes = ['Coding', 'Conceptual'];
        const errors = [];
        let imported = 0;
        let updated = 0;
        for (const row of data) {
            if (!row.ID || !row.Type || !row.Level || !row.Module || !row['Question Sample']) {
                errors.push(`Missing required fields for row: ${JSON.stringify(row).substring(0, 100)}`);
                continue;
            }
            if (!validLevels.includes(row.Level)) {
                errors.push(`Invalid Level "${row.Level}" for ID ${row.ID}`);
                continue;
            }
            if (!validTypes.includes(row.Type)) {
                errors.push(`Invalid Type "${row.Type}" for ID ${row.ID}`);
                continue;
            }
            const module = (0, string_js_1.normalizeUnicode)(row.Module);
            const existing = await postgres_js_1.default.query('SELECT id FROM question_bank WHERE id = $1', [row.ID]);
            if (existing.rows.length > 0) {
                updated++;
            }
            else {
                imported++;
            }
            await postgres_js_1.default.query(`
        INSERT INTO question_bank 
        (id, type, level, module, question_sample, rubric_must_have, rubric_nice_to_have, rubric_optional, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          level = EXCLUDED.level,
          module = EXCLUDED.module,
          question_sample = EXCLUDED.question_sample,
          rubric_must_have = EXCLUDED.rubric_must_have,
          rubric_nice_to_have = EXCLUDED.rubric_nice_to_have,
          rubric_optional = EXCLUDED.rubric_optional,
          updated_at = CURRENT_TIMESTAMP
      `, [row.ID, row.Type, row.Level, module, row['Question Sample'], row['Rubric Must-have'] || '', row['Rubric Nice-to-have'] || '', row['Rubric Optional'] || '']);
        }
        res.json({
            success: true,
            imported,
            updated,
            errors: errors.length > 0 ? errors : undefined
        });
    }
    catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: error.message });
    }
});
router.get('/questions', async (req, res) => {
    try {
        const result = await postgres_js_1.default.query('SELECT * FROM question_bank ORDER BY module, level');
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/questions/modules', async (req, res) => {
    try {
        const result = await postgres_js_1.default.query('SELECT DISTINCT module FROM question_bank ORDER BY module');
        res.json(result.rows.map((m) => m.module));
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.delete('/questions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await postgres_js_1.default.query('DELETE FROM question_bank WHERE id = $1', [id]);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/batches', async (req, res) => {
    try {
        const { name, start_time, end_time, duration, blueprint } = req.body;
        if (!name || !start_time || !end_time || !duration) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const totalQuestions = blueprint?.reduce((sum, item) => sum + item.easy + item.medium + item.hard, 0) || 0;
        if (totalQuestions !== 10) {
            return res.status(400).json({ error: 'Total questions must equal 10' });
        }
        const result = await postgres_js_1.default.query(`
      INSERT INTO batches (name, start_time, end_time, duration, blueprint, status)
      VALUES ($1, $2, $3, $4, $5, 'draft')
      RETURNING id
    `, [name, start_time, end_time, duration, JSON.stringify(blueprint)]);
        res.json({ success: true, id: result.rows[0].id });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/batches', async (req, res) => {
    try {
        const result = await postgres_js_1.default.query('SELECT * FROM batches ORDER BY created_at DESC');
        const batches = result.rows.map((b) => ({
            ...b,
            blueprint: b.blueprint ? JSON.parse(b.blueprint) : null
        }));
        res.json(batches);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/batches/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await postgres_js_1.default.query('SELECT * FROM batches WHERE id = $1', [parseInt(id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        const batch = result.rows[0];
        res.json({
            ...batch,
            blueprint: batch.blueprint ? JSON.parse(batch.blueprint) : null
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.put('/batches/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, start_time, end_time, duration, blueprint, status } = req.body;
        await postgres_js_1.default.query(`
      UPDATE batches SET name = $1, start_time = $2, end_time = $3, duration = $4, blueprint = $5, status = $6
      WHERE id = $7
    `, [name, start_time, end_time, duration, JSON.stringify(blueprint), status || 'draft', parseInt(id)]);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.delete('/batches/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await postgres_js_1.default.query('DELETE FROM batches WHERE id = $1', [parseInt(id)]);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/batches/:id/check-feasibility', async (req, res) => {
    try {
        const { blueprint } = req.body;
        const errors = [];
        for (const item of blueprint) {
            for (const level of ['Easy', 'Medium', 'Hard']) {
                const count = item[level.toLowerCase()];
                if (count > 0) {
                    const result = await postgres_js_1.default.query(`
            SELECT COUNT(*) as count FROM question_bank
            WHERE module = $1 AND level = $2
          `, [item.module, level]);
                    const available = parseInt(result.rows[0].count);
                    if (available < count) {
                        errors.push(`Module ${item.module} Level ${level} has only ${available} questions, need ${count}`);
                    }
                }
            }
        }
        res.json({ feasible: errors.length === 0, errors });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/batches/:id/students/import', async (req, res) => {
    try {
        const { id } = req.params;
        const { emails } = req.body;
        if (!emails || !Array.isArray(emails)) {
            return res.status(400).json({ error: 'Invalid emails array' });
        }
        const generateCode = () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        };
        const batchId = parseInt(id);
        for (const email of emails) {
            const code = generateCode();
            await postgres_js_1.default.query(`
        INSERT INTO students (batch_id, email, access_code, status)
        VALUES ($1, $2, $3, 'pending')
      `, [batchId, email.trim(), code]);
        }
        res.json({ success: true, count: emails.length });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/batches/:id/students', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await postgres_js_1.default.query('SELECT * FROM students WHERE batch_id = $1', [parseInt(id)]);
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/batches/:id/students/export', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await postgres_js_1.default.query('SELECT email, access_code FROM students WHERE batch_id = $1', [parseInt(id)]);
        const students = result.rows;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=students-${id}.xlsx`);
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.json_to_sheet(students);
        XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
        const buffer = XLSX.write(workbook, { type: 'buffer' });
        res.send(buffer);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/batches/:id/results', async (req, res) => {
    try {
        const { id } = req.params;
        const batchId = parseInt(id);
        const studentsResult = await postgres_js_1.default.query(`
      SELECT s.*, 
        AVG(eq.ai_score) as avg_ai_score,
        COUNT(eq.id) as questions_count
      FROM students s
      LEFT JOIN exam_questions eq ON s.id = eq.student_id
      WHERE s.batch_id = $1
      GROUP BY s.id
    `, [batchId]);
        const results = [];
        for (const student of studentsResult.rows) {
            const questionsResult = await postgres_js_1.default.query(`
        SELECT eq.*, q.type, q.level, q.module, q.question_sample, q.rubric_must_have, q.rubric_nice_to_have, q.rubric_optional
        FROM exam_questions eq
        JOIN question_bank q ON eq.question_id = q.id
        WHERE eq.student_id = $1
        ORDER BY eq.question_order
      `, [student.id]);
            const violationsResult = await postgres_js_1.default.query(`
        SELECT SUM(count) as total FROM violations WHERE student_id = $1
      `, [student.id]);
            results.push({
                student,
                questions: questionsResult.rows,
                violations: parseInt(violationsResult.rows[0]?.total) || 0
            });
        }
        res.json(results);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.put('/results/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const { trainer_score, trainer_feedback } = req.body;
        const questionsResult = await postgres_js_1.default.query('SELECT id FROM exam_questions WHERE student_id = $1', [parseInt(studentId)]);
        for (const q of questionsResult.rows) {
            await postgres_js_1.default.query(`
        UPDATE exam_questions 
        SET trainer_score = $1, trainer_feedback = $2
        WHERE id = $3
      `, [trainer_score, trainer_feedback, q.id]);
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/batches/:id/results/export', async (req, res) => {
    try {
        const { id } = req.params;
        const batchId = parseInt(id);
        const studentsResult = await postgres_js_1.default.query('SELECT id, email FROM students WHERE batch_id = $1', [batchId]);
        const workbook = XLSX.utils.book_new();
        for (const student of studentsResult.rows) {
            const questionsResult = await postgres_js_1.default.query(`
        SELECT eq.*, q.type, q.level, q.module, q.question_sample, 
          q.rubric_must_have, q.rubric_nice_to_have, q.rubric_optional
        FROM exam_questions eq
        JOIN question_bank q ON eq.question_id = q.id
        WHERE eq.student_id = $1
        ORDER BY eq.question_order
      `, [student.id]);
            const violationsResult = await postgres_js_1.default.query(`
        SELECT SUM(count) as total FROM violations WHERE student_id = $1
      `, [student.id]);
            const data = questionsResult.rows.map((q) => ({
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map