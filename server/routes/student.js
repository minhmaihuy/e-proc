"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const postgres_js_1 = __importDefault(require("../db/postgres.js"));
const queue_js_1 = require("../../ai/queue.js");
const router = (0, express_1.Router)();
router.post('/verify', async (req, res) => {
    try {
        const { access_code } = req.body;
        if (!access_code) {
            return res.status(400).json({ error: 'Access code required' });
        }
        const result = await postgres_js_1.default.query(`
      SELECT s.*, b.name as batch_name, b.start_time, b.end_time, b.duration
      FROM students s
      JOIN batches b ON s.batch_id = b.id
      WHERE s.access_code = $1
    `, [access_code]);
        const student = result.rows[0];
        if (!student) {
            return res.status(404).json({ error: 'Invalid access code' });
        }
        const now = new Date();
        const startTime = new Date(student.start_time);
        const endTime = new Date(student.end_time);
        if (now < startTime || now > endTime) {
            return res.status(400).json({ error: 'Exam is not available at this time' });
        }
        if (student.status === 'submitted') {
            return res.status(400).json({ error: 'Exam already submitted' });
        }
        const emailsResult = await postgres_js_1.default.query(`
      SELECT email FROM students 
      WHERE batch_id = $1 AND access_code = $2
    `, [student.batch_id, access_code]);
        res.json({
            valid: true,
            access_code: student.access_code,
            emails: emailsResult.rows.map(s => s.email),
            duration: student.duration,
            student_id: student.id
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/select-email', async (req, res) => {
    try {
        const { student_id, email } = req.body;
        const result = await postgres_js_1.default.query('SELECT * FROM students WHERE id = $1 AND email = $2', [student_id, email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invalid student or email' });
        }
        res.json({ valid: true, student_id: result.rows[0].id });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/exam/start', async (req, res) => {
    try {
        const { student_id } = req.body;
        const studentResult = await postgres_js_1.default.query('SELECT * FROM students WHERE id = $1', [student_id]);
        const student = studentResult.rows[0];
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        if (student.status !== 'pending') {
            return res.status(400).json({ error: 'Exam already started or submitted' });
        }
        const batchResult = await postgres_js_1.default.query('SELECT blueprint FROM batches WHERE id = $1', [student.batch_id]);
        const batch = batchResult.rows[0];
        const blueprint = JSON.parse(batch.blueprint || '[]');
        const questionIds = [];
        for (const item of blueprint) {
            for (const level of ['Easy', 'Medium', 'Hard']) {
                const count = item[level.toLowerCase()];
                if (count > 0) {
                    const availableResult = await postgres_js_1.default.query(`
            SELECT id FROM question_bank
            WHERE module = $1 AND level = $2
            ORDER BY RANDOM()
            LIMIT $3
          `, [item.module, level, count]);
                    for (const q of availableResult.rows) {
                        questionIds.push(q.id);
                    }
                }
            }
        }
        for (let i = 0; i < questionIds.length; i++) {
            await postgres_js_1.default.query(`
        INSERT INTO exam_questions (student_id, question_id, question_order)
        VALUES ($1, $2, $3)
      `, [student_id, questionIds[i], i + 1]);
        }
        await postgres_js_1.default.query("UPDATE students SET status = 'in_progress' WHERE id = $1", [student_id]);
        res.json({ success: true, questions_count: questionIds.length });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/exam/questions', async (req, res) => {
    try {
        const studentId = req.headers['x-student-id'];
        if (!studentId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const result = await postgres_js_1.default.query(`
      SELECT eq.question_order, eq.answer, q.id, q.type, q.level, q.module, q.question_sample
      FROM exam_questions eq
      JOIN question_bank q ON eq.question_id = q.id
      WHERE eq.student_id = $1
      ORDER BY eq.question_order
    `, [parseInt(studentId)]);
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/exam/answer', async (req, res) => {
    try {
        const studentId = req.headers['x-student-id'];
        if (!studentId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { question_order, answer } = req.body;
        await postgres_js_1.default.query(`
      UPDATE exam_questions SET answer = $1 
      WHERE student_id = $2 AND question_order = $3
    `, [answer, parseInt(studentId), question_order]);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/exam/submit', async (req, res) => {
    try {
        const studentId = req.headers['x-student-id'];
        if (!studentId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        await postgres_js_1.default.query("UPDATE students SET status = 'submitted' WHERE id = $1", [parseInt(studentId)]);
        const examQuestionsResult = await postgres_js_1.default.query('SELECT id FROM exam_questions WHERE student_id = $1', [parseInt(studentId)]);
        for (const eq of examQuestionsResult.rows) {
            await (0, queue_js_1.addToQueue)(eq.id, parseInt(studentId));
        }
        res.json({ success: true, message: 'Exam submitted. Results will be available shortly.' });
    }
    catch (error) {
        console.error('Submit error:', error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/violation', async (req, res) => {
    try {
        const studentId = req.headers['x-student-id'];
        if (!studentId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { type } = req.body;
        const existingResult = await postgres_js_1.default.query('SELECT * FROM violations WHERE student_id = $1 AND type = $2', [parseInt(studentId), type]);
        if (existingResult.rows.length === 0) {
            await postgres_js_1.default.query('INSERT INTO violations (student_id, type, count) VALUES ($1, $2, 1)', [parseInt(studentId), type]);
        }
        else {
            await postgres_js_1.default.query('UPDATE violations SET count = count + 1 WHERE id = $1', [existingResult.rows[0].id]);
        }
        const totalResult = await postgres_js_1.default.query('SELECT SUM(count) as total FROM violations WHERE student_id = $1', [parseInt(studentId)]);
        const total = parseInt(totalResult.rows[0]?.total) || 0;
        const currentResult = await postgres_js_1.default.query('SELECT count FROM violations WHERE student_id = $1 AND type = $2', [parseInt(studentId), type]);
        const currentCount = parseInt(currentResult.rows[0]?.count) || 0;
        res.json({
            violation_count: currentCount,
            total_violations: total,
            locked: currentCount >= 2 || total >= 2
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=student.js.map