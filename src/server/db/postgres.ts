import pg from 'pg';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { getCurrentTenantConfig } from '../tenantContext.js';

dotenv.config();

const USE_SQLITE = !process.env.DATABASE_URL;

console.log('[DB] Module loading...');
console.log('[DB] Mode:', USE_SQLITE ? 'SQLite (local dev)' : 'PostgreSQL (production)');
console.log('[DB] DATABASE_URL:', process.env.DATABASE_URL ? 'present' : 'MISSING');

let pgPool: pg.Pool | null = null;
let sqliteDb: Database.Database | null = null;
let sqliteTransactionTail: Promise<void> = Promise.resolve();

const { Pool } = pg;

/** Idempotent assessment-plane migration kept separately so legacy SQLite data can be regression-tested. */
export function ensureEmailUsageTablesSqlite(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT UNIQUE NOT NULL,
      template TEXT NOT NULL,
      recipient TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS email_suppressions (
      recipient TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      provider_event_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS usage_outbox (
      event_key TEXT PRIMARY KEY,
      metric TEXT NOT NULL,
      amount REAL NOT NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const usageOutboxColumns = (database.prepare("PRAGMA table_info(usage_outbox)").all() as { name: string }[])
    .map((column) => column.name);
  if (!usageOutboxColumns.includes('occurred_at')) {
    database.exec('ALTER TABLE usage_outbox ADD COLUMN occurred_at DATETIME');
    database.exec('UPDATE usage_outbox SET occurred_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE occurred_at IS NULL');
  }
}

async function initPostgres() {
  console.log('[DB] Attempting PostgreSQL connection...');
  
  const poolMax = parseInt(process.env.DB_POOL_MAX || '2');
  const poolMin = parseInt(process.env.DB_POOL_MIN || '0');
  
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
    min: poolMin,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false }
  });

  pgPool.on('error', (err) => console.error('[DB] Pool error:', err.message));
  pgPool.on('connect', () => console.log('[DB] New PG connection'));

  const client = await pgPool.connect();
  console.log('[DB] PostgreSQL connected!');
  
  await client.query(`SET statement_timeout = '${process.env.STATEMENT_TIMEOUT || '30s'}'`);
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS question_bank (
      id VARCHAR(50) PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('Coding', 'Conceptual', 'Fill-in', 'Debug')),
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

  // Migration: bộ đề (question_group) + khóa chính kép (id, question_group).
  //
  // Hai bộ đề khác nhau HOÀN TOÀN có thể dùng chung mã ID: hai file thật
  // QB_Output_CPP_EMB_PRINT_IOT và QB_Output_CPP_EMB_AUTOSAR trùng cả 100/100 mã
  // (CH6-E-01 … CH10-H-18). Khi khóa chỉ trên id, import bộ thứ hai UPDATE đè lên
  // đúng 100 câu của bộ thứ nhất — mất trắng dữ liệu, không có cảnh báo nào.
  try {
    await client.query(`ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS question_group TEXT`);
    // Bản plain-text của question_sample, sinh tự động lúc import. Dùng cho mọi nơi
    // KHÔNG phải renderer của học viên: prompt chấm AI và export Excel. Đưa HTML thô
    // vào prompt khiến AI phải đọc lẫn thẻ markup.
    await client.query(`ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS question_plain TEXT`);
    await client.query(`UPDATE question_bank SET question_group = '' WHERE question_group IS NULL`);
    await client.query(`ALTER TABLE question_bank ALTER COLUMN question_group SET DEFAULT ''`);
    await client.query(`ALTER TABLE question_bank ALTER COLUMN question_group SET NOT NULL`);

    const pk = await client.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'question_bank'::regclass AND i.indisprimary
    `);
    const pkCols = pk.rows.map((r: any) => r.attname).sort();
    if (!(pkCols.length === 2 && pkCols[0] === 'id' && pkCols[1] === 'question_group')) {
      console.log('[DB] question_bank PK:', pkCols, '→ đổi sang (id, question_group)');
      await client.query(`ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS question_bank_pkey`);
      await client.query(`ALTER TABLE question_bank ADD PRIMARY KEY (id, question_group)`);
    }
  } catch (err) {
    console.error('[DB] question_bank composite PK migration error:', err);
  }

  // Migration: cập nhật CHECK constraint type cho DB cũ
  // Dùng transaction atomic: check exists → chỉ drop+add nếu constraint chưa đúng
  try {
    await client.query('BEGIN');

    const constraintCheck = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS condef
      FROM pg_constraint
      WHERE conrelid = 'question_bank'::regclass
        AND conname = 'question_bank_type_check'
    `);

    const targetDef = `CHECK ((type = ANY (ARRAY['Coding'::text, 'Conceptual'::text, 'Fill-in'::text, 'Debug'::text, 'SingleChoice'::text, 'MultipleChoice'::text])))`;
    const existing = constraintCheck.rows[0];

    if (!existing) {
      // Constraint chưa tồn tại → ADD mới
      console.log('[DB] question_bank_type_check: not found → adding');
      await client.query(`
        ALTER TABLE question_bank
          ADD CONSTRAINT question_bank_type_check
          CHECK(type IN ('Coding', 'Conceptual', 'Fill-in', 'Debug', 'SingleChoice', 'MultipleChoice'))
      `);
    } else if (existing.condef !== targetDef) {
      // Constraint tồn tại nhưng định nghĩa cũ → DROP rồi ADD mới
      console.log('[DB] question_bank_type_check: outdated →', existing.condef);
      await client.query(`ALTER TABLE question_bank DROP CONSTRAINT question_bank_type_check`);
      await client.query(`
        ALTER TABLE question_bank
          ADD CONSTRAINT question_bank_type_check
          CHECK(type IN ('Coding', 'Conceptual', 'Fill-in', 'Debug', 'SingleChoice', 'MultipleChoice'))
      `);
    } else {
      console.log('[DB] question_bank_type_check: already up-to-date, skipping');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] question_bank_type_check migration error:', err);
  }

  // Migration: cột quiz (SingleChoice/MultipleChoice). Câu tự luận cũ để NULL.
  // options: JSON [{"key":"A","text":"..."}], correct_answers: JSON ["A","C"], score mặc định 1.
  const qbQuizCols = [
    { col: 'options', def: 'TEXT' },
    { col: 'correct_answers', def: 'TEXT' },
    { col: 'score', def: 'REAL DEFAULT 1' },
  ];
  for (const { col, def } of qbQuizCols) {
    try {
      await client.query(`ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    } catch (_) { /* already exists */ }
  }
  // Migration: người upload question (FK → admin_users). Question cũ để NULL.
  try {
    await client.query('ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL');
  } catch (_) { /* already exists */ }
  console.log('[DB] question_bank ready');

await client.query(`
    CREATE TABLE IF NOT EXISTS batches (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      duration INTEGER NOT NULL,
      blueprint JSONB,
      record_enabled BOOLEAN DEFAULT false,
      record_mode VARCHAR(16) DEFAULT 'none',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migration: cờ ghi màn hình lên S3 (chỉ admin bật được). Batch cũ mặc định false.
  try {
    await client.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS record_enabled BOOLEAN DEFAULT false');
  } catch (_) { /* already exists */ }
  // Migration: chế độ ghi màn hình 'none' | 'local' | 's3' (thay cho record_enabled bool).
  // Chỉ admin đặt được mode khác 'none'. Backfill: batch có record_enabled=true → 's3'.
  try {
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS record_mode VARCHAR(16) DEFAULT 'none'");
    await client.query("UPDATE batches SET record_mode = 's3' WHERE record_enabled = true AND (record_mode IS NULL OR record_mode = 'none')");
  } catch (_) { /* already exists */ }
  // Migration: loại đề (essay = tự luận/coding, quiz = trắc nghiệm). Batch cũ mặc định 'essay'.
  try {
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS exam_type TEXT DEFAULT 'essay'");
  } catch (_) { /* already exists */ }
  // Migration: người tạo batch (FK → admin_users). Batch cũ để NULL.
  try {
    await client.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL');
  } catch (_) { /* already exists */ }
  
  const seqCheck = await client.query("SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM batches");
  await client.query(`SELECT setval('batches_id_seq', ${seqCheck.rows[0].next_id})`);
  // Migration: batch dạng Practice trỏ tới 1 bài practice đã import
  // (NULL = batch thi thường theo blueprint). Một batch hoặc theo blueprint, hoặc
  // theo practice — không bao giờ cả hai.
  try {
    await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS practice_exam_id INTEGER`);
  } catch (_) { /* already exists */ }
  console.log('[DB] batches ready');

  // Bài thi Practice: import từ file .docx, quản lý độc lập với question_bank
  await client.query(`
    CREATE TABLE IF NOT EXISTS practice_exams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      content_html TEXT NOT NULL,
      content_plain TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[DB] practice_exams ready');
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      access_code VARCHAR(8) NOT NULL,
      status TEXT DEFAULT 'pending',
      exam_started_at TIMESTAMP,
      exam_deadline TIMESTAMP,
      disconnected_at TIMESTAMP,
      recording_password TEXT,
      submitted_at TIMESTAMP,
      submit_reason TEXT,
      active_jti TEXT,
      recording_finalized_at TIMESTAMP,
      recording_final_part_index INTEGER,
      recording_incomplete BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: thêm cột mới nếu chưa tồn tại (cho DB cũ)
  const colChecks = [
    { col: 'exam_started_at', def: 'TIMESTAMP' },
    { col: 'exam_deadline', def: 'TIMESTAMP' },
    { col: 'disconnected_at', def: 'TIMESTAMP' },
    { col: 'recording_password', def: 'TEXT' },
    { col: 'submitted_at', def: 'TIMESTAMP' },
    { col: 'submit_reason', def: 'TEXT' },
    { col: 'active_jti', def: 'TEXT' },
    { col: 'recording_finalized_at', def: 'TIMESTAMP' },
    { col: 'recording_final_part_index', def: 'INTEGER' },
    { col: 'recording_incomplete', def: 'BOOLEAN DEFAULT FALSE' },
  ];
  for (const { col, def } of colChecks) {
    try {
      await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    } catch (_) { /* already exists */ }
  }
  console.log('[DB] students ready');

  // Bài làm practice: 1 học viên = 1 bài làm duy nhất cho batch practice của mình.
  // PHẢI tạo sau students: PostgreSQL kiểm tra foreign key ngay khi CREATE TABLE, đặt
  // trước sẽ hỏng khi khởi tạo trên một database hoàn toàn mới.
  await client.query(`
    CREATE TABLE IF NOT EXISTS practice_submissions (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      practice_exam_id INTEGER NOT NULL,
      answer TEXT,
      ai_score FLOAT,
      ai_feedback TEXT,
      trainer_score FLOAT,
      trainer_feedback TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[DB] practice_submissions ready');
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      question_id VARCHAR(50) NOT NULL,
      question_order INTEGER NOT NULL,
      answer TEXT,
      ai_score FLOAT,
      ai_feedback TEXT,
      trainer_score FLOAT,
      trainer_feedback TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migration: thứ tự option đã xáo cho riêng SV (quiz). JSON ["C","A","F","B"]. Câu tự luận để NULL.
  try {
    await client.query('ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS option_order TEXT');
    // question_id một mình không còn xác định được câu hỏi sau khi question_bank đổi
    // sang khóa (id, question_group) → lưu kèm group của câu đã gán cho học viên.
    await client.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_group TEXT DEFAULT ''`);
    await client.query(`UPDATE exam_questions SET question_group = '' WHERE question_group IS NULL`);
  } catch (_) { /* already exists */ }
  console.log('[DB] exam_questions ready');
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS violations (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[DB] violations ready');

  // Anti-Cheat: append-only forensic log — mỗi lần vi phạm một dòng (khác với
  // bảng violations vốn khóa theo (student_id, type) nên chỉ đếm được số lần).
  // content_preview chỉ có với suspicious_paste (500 ký tự đầu); focus_lost để NULL.
  await client.query(`
    CREATE TABLE IF NOT EXISTS violation_events (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      batch_id INTEGER,
      type TEXT NOT NULL,
      text_length INTEGER,
      content_preview VARCHAR(500),
      question_id VARCHAR(50),
      metadata_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[DB] violation_events ready');
  try {
    await client.query('ALTER TABLE violation_events ADD COLUMN IF NOT EXISTS metadata_json TEXT');
  } catch (_) { /* already exists */ }

  await client.query(`
    CREATE TABLE IF NOT EXISTS recording_parts (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL,
      part_index INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      byte_size INTEGER,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_final BOOLEAN DEFAULT FALSE,
      UNIQUE(student_id, part_index)
    )
  `);
  await client.query('ALTER TABLE recording_parts ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT FALSE');

  // Anti-Cheat: theo dõi phiên thi để phát hiện dùng đồng thời nhiều client/IP.
  // Mỗi cặp (student × jti × ip) một dòng; đổi IP tạo dòng mới. last_seen cập nhật mỗi request.
  await client.query(`
    CREATE TABLE IF NOT EXISTS exam_sessions (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      batch_id INTEGER,
      jti TEXT,
      ip TEXT,
      user_agent TEXT,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, jti, ip)
    )
  `);
  try {
    await client.query('CREATE INDEX IF NOT EXISTS idx_exam_sessions_student ON exam_sessions(student_id)');
  } catch (_) { /* ignore */ }
  console.log('[DB] exam_sessions ready');

  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_queue (
      id SERIAL PRIMARY KEY,
      exam_question_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migration: phân biệt job chấm exam_questions vs practice_submissions
  // (kind='practice' thì exam_question_id thực chất là practice_submissions.id)
  try {
    await client.query(`ALTER TABLE ai_queue ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'exam'`);
  } catch (_) { /* already exists */ }
  console.log('[DB] ai_queue ready');

  await client.query(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id SERIAL PRIMARY KEY,
      dedupe_key VARCHAR(180) UNIQUE NOT NULL,
      template VARCHAR(40) NOT NULL,
      recipient VARCHAR(254) NOT NULL,
      payload_json TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_code VARCHAR(64),
      sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      recipient VARCHAR(254) PRIMARY KEY,
      reason VARCHAR(24) NOT NULL,
      provider_event_id VARCHAR(180),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS usage_outbox (
      event_key VARCHAR(180) PRIMARY KEY,
      metric VARCHAR(32) NOT NULL,
      amount NUMERIC NOT NULL,
      occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query('ALTER TABLE usage_outbox ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP');
  await client.query('UPDATE usage_outbox SET occurred_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE occurred_at IS NULL');
  await client.query('ALTER TABLE usage_outbox ALTER COLUMN occurred_at SET DEFAULT CURRENT_TIMESTAMP');
  await client.query('ALTER TABLE usage_outbox ALTER COLUMN occurred_at SET NOT NULL');
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migration: thêm cột role cho DB cũ (user cũ mặc định 'admin' để không mất quyền)
  try {
    await client.query("ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'");
  } catch (_) { /* already exists */ }
  console.log('[DB] admin_users ready');

  client.release();
  console.log('[DB] All PostgreSQL tables initialized');
}

function initSqlite() {
  console.log('[DB] Initializing SQLite...');
  
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const dbPath = path.join(dataDir, 'eaudit.db');
  
  try {
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    console.log('[DB] SQLite connected at:', dbPath);
    
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS question_bank (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        level TEXT NOT NULL,
        module TEXT NOT NULL,
        question_sample TEXT NOT NULL,
        rubric_must_have TEXT NOT NULL,
        rubric_nice_to_have TEXT NOT NULL,
        rubric_optional TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        duration INTEGER NOT NULL,
        blueprint TEXT,
        record_enabled INTEGER DEFAULT 0,
        record_mode TEXT DEFAULT 'none',
        practice_exam_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: batch dạng Practice (NULL = batch thi thường theo blueprint)
    const batchPracticeCols = (sqliteDb.prepare("PRAGMA table_info(batches)").all() as { name: string }[]).map(c => c.name);
    if (!batchPracticeCols.includes('practice_exam_id')) {
      sqliteDb.exec('ALTER TABLE batches ADD COLUMN practice_exam_id INTEGER');
    }

    // Bài thi Practice: import từ file .docx, quản lý độc lập với question_bank
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS practice_exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content_html TEXT NOT NULL,
        content_plain TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        access_code TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        exam_started_at DATETIME,
        exam_deadline DATETIME,
        disconnected_at DATETIME,
        recording_password TEXT,
        submitted_at DATETIME,
        submit_reason TEXT,
        active_jti TEXT,
        recording_finalized_at DATETIME,
        recording_final_part_index INTEGER,
        recording_incomplete INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
      )
    `);

    // Bài làm practice: 1 học viên = 1 bài làm duy nhất. Giữ cùng thứ tự phụ thuộc với
    // PostgreSQL: students trước practice_submissions.
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS practice_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        practice_exam_id INTEGER NOT NULL,
        answer TEXT,
        ai_score REAL,
        ai_feedback TEXT,
        trainer_score REAL,
        trainer_feedback TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);

    // Migration: thêm cột mới nếu chưa tồn tại (cho SQLite DB cũ)
    const existingCols = sqliteDb.prepare("PRAGMA table_info(students)").all() as { name: string }[];
    const colNames = existingCols.map((c) => c.name);
    if (!colNames.includes('exam_started_at')) {
      sqliteDb.exec('ALTER TABLE students ADD COLUMN exam_started_at DATETIME');
    }
    if (!colNames.includes('exam_deadline')) {
      sqliteDb.exec('ALTER TABLE students ADD COLUMN exam_deadline DATETIME');
    }
    if (!colNames.includes('disconnected_at')) {
      sqliteDb.exec('ALTER TABLE students ADD COLUMN disconnected_at DATETIME');
    }
    if (!colNames.includes('recording_password')) {
      sqliteDb.exec('ALTER TABLE students ADD COLUMN recording_password TEXT');
    }
    const studentAdds: Array<[string, string]> = [
      ['submitted_at', 'DATETIME'], ['submit_reason', 'TEXT'], ['active_jti', 'TEXT'],
      ['recording_finalized_at', 'DATETIME'], ['recording_final_part_index', 'INTEGER'],
      ['recording_incomplete', 'INTEGER DEFAULT 0'],
    ];
    for (const [name, def] of studentAdds) {
      if (!colNames.includes(name)) sqliteDb.exec(`ALTER TABLE students ADD COLUMN ${name} ${def}`);
    }
    
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS exam_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        question_order INTEGER NOT NULL,
        answer TEXT,
        ai_score REAL,
        ai_feedback TEXT,
        trainer_score REAL,
        trainer_feedback TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS violation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        batch_id INTEGER,
        type TEXT NOT NULL,
        text_length INTEGER,
        content_preview TEXT,
        question_id TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    const violationEventCols = sqliteDb.prepare("PRAGMA table_info(violation_events)").all() as { name: string }[];
    if (!violationEventCols.some((col) => col.name === 'metadata_json')) {
      sqliteDb.exec('ALTER TABLE violation_events ADD COLUMN metadata_json TEXT');
    }

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS recording_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        batch_id INTEGER NOT NULL,
        part_index INTEGER NOT NULL,
        object_key TEXT NOT NULL,
        byte_size INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_final INTEGER DEFAULT 0,
        UNIQUE(student_id, part_index),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    const recordingPartCols = (sqliteDb.prepare("PRAGMA table_info(recording_parts)").all() as { name: string }[]).map(c => c.name);
    if (!recordingPartCols.includes('is_final')) sqliteDb.exec('ALTER TABLE recording_parts ADD COLUMN is_final INTEGER DEFAULT 0');

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS exam_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        batch_id INTEGER,
        jti TEXT,
        ip TEXT,
        user_agent TEXT,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, jti, ip),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    sqliteDb.exec('CREATE INDEX IF NOT EXISTS idx_exam_sessions_student ON exam_sessions(student_id)');

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS ai_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_question_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    ensureEmailUsageTablesSqlite(sqliteDb);
    
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration cho SQLite DB cũ: thêm cột nếu chưa có (SQLite không có IF NOT EXISTS cho ADD COLUMN)
    const batchCols = (sqliteDb.prepare("PRAGMA table_info(batches)").all() as { name: string }[]).map(c => c.name);
    if (!batchCols.includes('record_enabled')) {
      sqliteDb.exec('ALTER TABLE batches ADD COLUMN record_enabled INTEGER DEFAULT 0');
    }
    if (!batchCols.includes('exam_type')) {
      sqliteDb.exec("ALTER TABLE batches ADD COLUMN exam_type TEXT DEFAULT 'essay'");
    }
    if (!batchCols.includes('record_mode')) {
      sqliteDb.exec("ALTER TABLE batches ADD COLUMN record_mode TEXT DEFAULT 'none'");
      // Backfill: batch cũ có record_enabled=1 → 's3'
      sqliteDb.exec("UPDATE batches SET record_mode = 's3' WHERE record_enabled = 1 AND (record_mode IS NULL OR record_mode = 'none')");
    }
    if (!batchCols.includes('created_by')) {
      sqliteDb.exec('ALTER TABLE batches ADD COLUMN created_by INTEGER');
    }
    const adminCols = (sqliteDb.prepare("PRAGMA table_info(admin_users)").all() as { name: string }[]).map(c => c.name);
    if (!adminCols.includes('role')) {
      sqliteDb.exec("ALTER TABLE admin_users ADD COLUMN role TEXT DEFAULT 'admin'");
    }
    // Migration: cột quiz cho question_bank + option_order cho exam_questions (SQLite DB cũ)
    const qbCols = (sqliteDb.prepare("PRAGMA table_info(question_bank)").all() as { name: string }[]).map(c => c.name);
    if (!qbCols.includes('options')) sqliteDb.exec('ALTER TABLE question_bank ADD COLUMN options TEXT');
    if (!qbCols.includes('correct_answers')) sqliteDb.exec('ALTER TABLE question_bank ADD COLUMN correct_answers TEXT');
    if (!qbCols.includes('score')) sqliteDb.exec('ALTER TABLE question_bank ADD COLUMN score REAL DEFAULT 1');
    if (!qbCols.includes('uploaded_by')) sqliteDb.exec('ALTER TABLE question_bank ADD COLUMN uploaded_by INTEGER');
    if (!qbCols.includes('question_group')) {
      sqliteDb.exec("ALTER TABLE question_bank ADD COLUMN question_group TEXT NOT NULL DEFAULT ''");
    }
    if (!qbCols.includes('question_plain')) {
      sqliteDb.exec('ALTER TABLE question_bank ADD COLUMN question_plain TEXT');
    }
    // Migration: phân biệt job chấm exam_questions vs practice_submissions
    const aiQueueCols = (sqliteDb.prepare("PRAGMA table_info(ai_queue)").all() as { name: string }[]).map(c => c.name);
    if (!aiQueueCols.includes('kind')) {
      sqliteDb.exec("ALTER TABLE ai_queue ADD COLUMN kind TEXT DEFAULT 'exam'");
    }
    const eqCols = (sqliteDb.prepare("PRAGMA table_info(exam_questions)").all() as { name: string }[]).map(c => c.name);
    if (!eqCols.includes('option_order')) sqliteDb.exec('ALTER TABLE exam_questions ADD COLUMN option_order TEXT');
    // Group của câu đã gán: question_id một mình không còn định danh được câu hỏi.
    if (!eqCols.includes('question_group')) {
      sqliteDb.exec("ALTER TABLE exam_questions ADD COLUMN question_group TEXT DEFAULT ''");
      sqliteDb.exec("UPDATE exam_questions SET question_group = '' WHERE question_group IS NULL");
    }

    // Migration: khóa chính kép (id, question_group) — xem giải thích ở nhánh Postgres.
    // SQLite không đổi được PRIMARY KEY bằng ALTER nên phải dựng bảng mới rồi copy sang.
    const qbPk = (sqliteDb.prepare("PRAGMA table_info(question_bank)").all() as { name: string; pk: number }[])
      .filter(c => c.pk > 0).map(c => c.name).sort();
    if (!(qbPk.length === 2 && qbPk[0] === 'id' && qbPk[1] === 'question_group')) {
      console.log('[DB] question_bank PK:', qbPk, '→ rebuild sang (id, question_group)');
      const cols = (sqliteDb.prepare("PRAGMA table_info(question_bank)").all() as { name: string }[]).map(c => c.name);
      const optional = ['options', 'correct_answers', 'score', 'uploaded_by', 'question_plain'].filter(c => cols.includes(c));
      const copyCols = ['id', 'type', 'level', 'module', 'question_group', 'question_sample',
        'rubric_must_have', 'rubric_nice_to_have', 'rubric_optional', 'created_at', 'updated_at', ...optional];
      sqliteDb.exec('DROP TABLE IF EXISTS question_bank_new');
      sqliteDb.exec(`
        CREATE TABLE question_bank_new (
          id TEXT NOT NULL,
          type TEXT NOT NULL,
          level TEXT NOT NULL,
          module TEXT NOT NULL,
          question_group TEXT NOT NULL DEFAULT '',
          question_sample TEXT NOT NULL,
          question_plain TEXT,
          rubric_must_have TEXT NOT NULL,
          rubric_nice_to_have TEXT NOT NULL,
          rubric_optional TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          options TEXT,
          correct_answers TEXT,
          score REAL DEFAULT 1,
          uploaded_by INTEGER,
          PRIMARY KEY (id, question_group)
        )
      `);
      const selectCols = copyCols
        .map(c => (c === 'question_group' ? "COALESCE(question_group, '') AS question_group" : c))
        .join(', ');
      sqliteDb.exec(`INSERT INTO question_bank_new (${copyCols.join(', ')}) SELECT ${selectCols} FROM question_bank`);
      sqliteDb.exec('DROP TABLE question_bank');
      sqliteDb.exec('ALTER TABLE question_bank_new RENAME TO question_bank');
      console.log('[DB] question_bank rebuilt với PK (id, question_group)');
    }

    console.log('[DB] All SQLite tables initialized');
  } catch (err) {
    console.error('[DB] SQLite init error:', err);
    throw err;
  }
}

export async function initDatabase() {
  if (USE_SQLITE) {
    initSqlite();
  } else {
    await initPostgres();
  }
  await bindDataPlaneTenant();
}

export function assertDataPlaneTenantBinding(existingSlug: unknown, requestedSlug: string): void {
  const normalizedExisting = String(existingSlug || '').trim().toLowerCase() === 'fsa'
    ? 'fsa-cls'
    : String(existingSlug || '').trim().toLowerCase();
  if (normalizedExisting && normalizedExisting !== requestedSlug) {
    throw new Error(`Assessment database belongs to tenant "${normalizedExisting}" and cannot be rebound to "${requestedSlug}".`);
  }
}

export async function bindDataPlaneTenant(): Promise<void> {
  const config = getCurrentTenantConfig();
  await query(`CREATE TABLE IF NOT EXISTS data_plane_metadata (
    metadata_key VARCHAR(64) PRIMARY KEY,
    metadata_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  const existingSlug = (await query(
    "SELECT metadata_value FROM data_plane_metadata WHERE metadata_key = 'tenant_slug'",
  )).rows[0]?.metadata_value;
  assertDataPlaneTenantBinding(existingSlug, config.slug);
  for (const [key, value] of [['tenant_slug', config.slug], ['tenant_name', config.name]]) {
    const updated = await query(
      'UPDATE data_plane_metadata SET metadata_value = ?, updated_at = CURRENT_TIMESTAMP WHERE metadata_key = ?',
      [value, key],
    );
    if (updated.rowCount === 0) {
      await query('INSERT INTO data_plane_metadata (metadata_key, metadata_value) VALUES (?, ?)', [key, value]);
    }
  }
}

export async function closeDatabase(): Promise<void> {
  if (pgPool) {
    const pool = pgPool;
    pgPool = null;
    await pool.end();
  }
  if (sqliteDb) {
    const database = sqliteDb;
    sqliteDb = null;
    if (database.open) database.close();
  }
}

interface DbResult {
  rows: any[];
  rowCount: number;
  lastInsertRowid?: number | bigint;
}

export interface DbExecutor {
  query(text: string, params?: any[]): Promise<DbResult>;
}

function postgresText(text: string, params?: any[]): string {
  if (!params?.length || text.includes('$1')) return text;
  let paramIndex = 1;
  return text.replace(/\?/g, () => '$' + paramIndex++);
}

export async function query(text: string, params?: any[]): Promise<DbResult> {
  if (USE_SQLITE && sqliteDb) {
    try {
      const stmt = sqliteDb.prepare(text);
      // Phải chạy .all() cho cả INSERT ... RETURNING, không chỉ SELECT. Dùng .run()
      // luôn trả rows: [] nên `INSERT INTO students ... RETURNING id` cho ra undefined:
      // students/import đọc studentResult.rows[0]?.id, gặp undefined rồi `continue`, khiến
      // học viên được tạo nhưng KHÔNG được gán câu hỏi nào. Postgres không dính vì nhánh
      // của nó luôn trả rows thật.
      const upper = text.trim().toUpperCase();
      if (upper.startsWith('SELECT') || upper.includes('RETURNING')) {
        return { rows: stmt.all(...(params || [])), rowCount: 0 };
      } else {
        const result = stmt.run(...(params || []));
        return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
    } catch (err) {
      console.error('[DB] SQLite query error:', err);
      throw err;
    }
  }
  
  if (pgPool) {
    if (params && params.length > 0) {
      const result = await pgPool.query(postgresText(text, params), params);
      return { rows: result.rows, rowCount: result.rowCount || 0, lastInsertRowid: undefined };
    }
    const result = await pgPool.query(text);
    return { rows: result.rows, rowCount: result.rowCount || 0, lastInsertRowid: undefined };
  }
  
  throw new Error('No database connection available');
}

/** Run all statements on one physical connection. Required for row locks and atomic exam state changes. */
export async function withTransaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
  if (USE_SQLITE && sqliteDb) {
    const previous = sqliteTransactionTail;
    let release!: () => void;
    sqliteTransactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    let began = false;
    try {
      sqliteDb.exec('BEGIN IMMEDIATE');
      began = true;
      const result = await work({ query });
      sqliteDb.exec('COMMIT');
      return result;
    } catch (error) {
      if (began) sqliteDb.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }

  if (!pgPool) throw new Error('No database connection available');
  const client = await pgPool.connect();
  const tx: DbExecutor = {
    query: async (text: string, params?: any[]) => {
      const result = await client.query(postgresText(text, params), params);
      return { rows: result.rows, rowCount: result.rowCount || 0 };
    },
  };
  try {
    await client.query('BEGIN');
    const result = await work(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function getPool() {
  if (USE_SQLITE) return sqliteDb;
  return pgPool;
}

export default { initDatabase, closeDatabase, query, withTransaction, getPool };
