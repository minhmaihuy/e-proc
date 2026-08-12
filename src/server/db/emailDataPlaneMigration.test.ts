import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureEmailUsageTablesSqlite } from './postgres.js';

test('email and usage data-plane migration is repeatable and preserves assessment rows', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE question_bank (id TEXT PRIMARY KEY, question_sample TEXT NOT NULL);
      CREATE TABLE students (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE exam_questions (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL);
      CREATE TABLE violation_events (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL);
      CREATE TABLE usage_outbox (
        event_key TEXT PRIMARY KEY, metric TEXT NOT NULL, amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO question_bank VALUES ('q-1', 'Legacy question');
      INSERT INTO students VALUES (1, 'candidate@example.com');
      INSERT INTO exam_questions VALUES (1, 1);
      INSERT INTO violation_events VALUES (1, 1);
      INSERT INTO usage_outbox (event_key, metric, amount, created_at)
        VALUES ('legacy-event', 'exams_started', 1, '2026-07-31 23:59:59');
    `);
    const tables = ['question_bank', 'students', 'exam_questions', 'violation_events'];
    const countsBefore = Object.fromEntries(tables.map((table) => [
      table,
      Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count),
    ]));

    ensureEmailUsageTablesSqlite(database);
    ensureEmailUsageTablesSqlite(database);

    for (const table of tables) {
      const count = Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
      assert.equal(count, countsBefore[table], `${table} rows must survive a repeat migration`);
    }
    for (const table of ['email_queue', 'email_suppressions', 'usage_outbox']) {
      assert.equal(Number((database.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table) as { count: number }).count), 1);
    }
    const outboxColumns = (database.prepare('PRAGMA table_info(usage_outbox)').all() as { name: string }[])
      .map((column) => column.name);
    assert.ok(outboxColumns.includes('occurred_at'));
    const legacyEvent = database.prepare("SELECT occurred_at FROM usage_outbox WHERE event_key = 'legacy-event'").get() as { occurred_at: string };
    assert.equal(legacyEvent.occurred_at, '2026-07-31 23:59:59', 'legacy outbox rows retain their original creation month');
  } finally {
    database.close();
  }
});
