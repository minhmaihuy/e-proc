import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureIdentitySchemaSqlite } from './postgres.js';

test('identity data-plane migration is repeatable and preserves legacy assessment rows', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE question_bank (id TEXT PRIMARY KEY, question_sample TEXT NOT NULL);
      CREATE TABLE batches (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE students (id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL, email TEXT NOT NULL);
      CREATE TABLE exam_questions (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL);
      CREATE TABLE violation_events (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL);
      INSERT INTO question_bank VALUES ('q-1', 'Legacy question');
      INSERT INTO batches VALUES (1, 'Legacy batch');
      INSERT INTO students VALUES (1, 1, 'candidate@example.com');
      INSERT INTO exam_questions VALUES (1, 1);
      INSERT INTO violation_events VALUES (1, 1);
    `);
    const tables = ['question_bank', 'batches', 'students', 'exam_questions', 'violation_events'];
    const before = Object.fromEntries(tables.map((table) => [
      table,
      Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count),
    ]));
    ensureIdentitySchemaSqlite(database);
    ensureIdentitySchemaSqlite(database);
    for (const table of tables) {
      const count = Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
      assert.equal(count, before[table], `${table} rows must survive repeat identity migration`);
    }
    const batch = database.prepare('SELECT identity_verification FROM batches WHERE id = 1').get() as { identity_verification: string };
    const student = database.prepare('SELECT identity_status, identity_capture_id FROM students WHERE id = 1').get() as { identity_status: string; identity_capture_id: string | null };
    assert.equal(batch.identity_verification, 'off');
    assert.equal(student.identity_status, 'not_required');
    assert.equal(student.identity_capture_id, null);
  } finally {
    database.close();
  }
});
