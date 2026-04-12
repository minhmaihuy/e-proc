"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.query = query;
exports.getClient = getClient;
const pg_1 = __importDefault(require("pg"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const { Pool } = pg_1.default;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    min: parseInt(process.env.DB_POOL_MIN || '2'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
});
async function initDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS question_bank (
        id VARCHAR(50) PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('Coding', 'Conceptual')),
        level TEXT NOT NULL CHECK(level IN ('Easy', 'Medium', 'Hard')),
        module TEXT NOT NULL,
        question_sample TEXT NOT NULL,
        rubric_must_have TEXT NOT NULL,
        rubric_nice_to_have TEXT NOT NULL,
        rubric_optional TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        duration INTEGER NOT NULL,
        blueprint JSONB,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        access_code VARCHAR(6) NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'submitted')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await client.query(`
      CREATE TABLE IF NOT EXISTS exam_questions (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        question_id VARCHAR(50) NOT NULL REFERENCES question_bank(id),
        question_order INTEGER NOT NULL,
        answer TEXT,
        ai_score FLOAT,
        ai_feedback TEXT,
        trainer_score FLOAT,
        trainer_feedback TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await client.query(`
      CREATE TABLE IF NOT EXISTS violations (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await client.query(`
      CREATE TABLE IF NOT EXISTS ai_queue (
        id SERIAL PRIMARY KEY,
        exam_question_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_queue_status ON ai_queue(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_students_code ON students(access_code)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_exam_questions_student ON exam_questions(student_id)`);
        console.log('Database initialized successfully');
    }
    finally {
        client.release();
    }
}
async function query(text, params) {
    return await pool.query(text, params);
}
async function getClient() {
    return pool.connect();
}
exports.default = { initDatabase, query, getClient, pool };
//# sourceMappingURL=postgres.js.map