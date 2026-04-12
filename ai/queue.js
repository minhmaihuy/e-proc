"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addToQueue = addToQueue;
exports.processQueue = processQueue;
exports.getQueueStats = getQueueStats;
const generative_ai_1 = require("@google/generative-ai");
const postgres_js_1 = require("../server/db/postgres.js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
async function addToQueue(examQuestionId, studentId) {
    const result = await (0, postgres_js_1.query)(`INSERT INTO ai_queue (exam_question_id, student_id, status) VALUES ($1, $2, 'pending') RETURNING id`, [examQuestionId, studentId]);
    console.log(`Added job ${result.rows[0].id} to AI queue`);
}
async function processQueue(limit = 10) {
    const result = await (0, postgres_js_1.query)(`SELECT id, exam_question_id, student_id FROM ai_queue 
     WHERE status = 'pending' 
     ORDER BY created_at ASC 
     LIMIT $1`, [limit]);
    let processed = 0;
    for (const job of result.rows) {
        try {
            await (0, postgres_js_1.query)(`UPDATE ai_queue SET status = 'processing', attempts = attempts + 1, updated_at = NOW() WHERE id = $1`, [job.id]);
            const examResult = await (0, postgres_js_1.query)(`
        SELECT eq.*, q.question_sample, q.rubric_must_have, q.rubric_nice_to_have, q.rubric_optional
        FROM exam_questions eq
        JOIN question_bank q ON eq.question_id = q.id
        WHERE eq.id = $1
      `, [job.exam_question_id]);
            if (examResult.rows.length === 0) {
                await (0, postgres_js_1.query)(`UPDATE ai_queue SET status = 'failed', error_message = 'Question not found', updated_at = NOW() WHERE id = $1`, [job.id]);
                continue;
            }
            const eq = examResult.rows[0];
            if (!eq.answer) {
                await (0, postgres_js_1.query)(`UPDATE exam_questions SET ai_score = 0.0, ai_feedback = 'No answer provided' WHERE id = $1`, [job.exam_question_id]);
                await (0, postgres_js_1.query)(`UPDATE ai_queue SET status = 'completed', updated_at = NOW() WHERE id = $1`, [job.id]);
                processed++;
                continue;
            }
            const prompt = `You are an expert technical interviewer. Evaluate the following answer based on the rubric.

Question: ${eq.question_sample}
Answer: ${eq.answer}

Rubric Must-have (70%): ${eq.rubric_must_have}
Rubric Nice-to-have (20%): ${eq.rubric_nice_to_have}
Rubric Optional (10%): ${eq.rubric_optional}

Provide a JSON response with "score" (0-10) and "feedback" (detailed feedback):
`;
            const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const aiResult = await model.generateContent(prompt);
            const text = aiResult.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                await (0, postgres_js_1.query)(`
          UPDATE exam_questions SET ai_score = $1, ai_feedback = $2 WHERE id = $3
        `, [parsed.score, parsed.feedback, job.exam_question_id]);
                await (0, postgres_js_1.query)(`UPDATE ai_queue SET status = 'completed', updated_at = NOW() WHERE id = $1`, [job.id]);
                console.log(`Processed job ${job.id}: Score ${parsed.score}`);
                processed++;
            }
            else {
                throw new Error('No JSON in AI response');
            }
        }
        catch (error) {
            console.error(`Failed to process job ${job.id}:`, error.message);
            const checkResult = await (0, postgres_js_1.query)(`SELECT attempts FROM ai_queue WHERE id = $1`, [job.id]);
            const attempts = checkResult.rows[0]?.attempts || 0;
            if (attempts >= 3) {
                await (0, postgres_js_1.query)(`UPDATE ai_queue SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`, [error.message, job.id]);
                await (0, postgres_js_1.query)(`UPDATE exam_questions SET ai_score = 0.0, ai_feedback = $1 WHERE id = $2`, ['AI Evaluation Failed: ' + error.message, job.exam_question_id]);
            }
            else {
                await (0, postgres_js_1.query)(`UPDATE ai_queue SET status = 'pending', updated_at = NOW() WHERE id = $1`, [job.id]);
            }
        }
    }
    return processed;
}
async function getQueueStats() {
    const result = await (0, postgres_js_1.query)(`
    SELECT 
      status,
      COUNT(*) as count
    FROM ai_queue
    GROUP BY status
  `);
    return result.rows;
}
exports.default = { addToQueue, processQueue, getQueueStats };
//# sourceMappingURL=queue.js.map