import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DatabaseMigrationError,
  DatabaseMigrationStep,
  runDatabaseMigrations,
} from './databaseMigration.js';

function migrationSteps(events: string[]): DatabaseMigrationStep[] {
  return (['assessment', 'control', 'log'] as const).map((plane) => ({
    plane,
    migrate: async () => { events.push(`migrate:${plane}`); },
    close: async () => { events.push(`close:${plane}`); },
  }));
}

test('database migrations run all planes in ownership order and close in reverse order', async () => {
  const events: string[] = [];
  const results = await runDatabaseMigrations(migrationSteps(events));
  assert.deepEqual(results.map((result) => result.plane), ['assessment', 'control', 'log']);
  assert.deepEqual(events, [
    'migrate:assessment',
    'migrate:control',
    'migrate:log',
    'close:log',
    'close:control',
    'close:assessment',
  ]);
});

test('database migration stops at the failing plane and still closes every connection', async () => {
  const events: string[] = [];
  const steps = migrationSteps(events);
  steps[1].migrate = async () => {
    events.push('migrate:control');
    throw new Error('connection details must not escape');
  };

  await assert.rejects(
    runDatabaseMigrations(steps),
    (error: unknown) => error instanceof DatabaseMigrationError
      && error.code === 'MIGRATION_FAILED'
      && error.plane === 'control'
      && !error.message.includes('connection details'),
  );
  assert.deepEqual(events, [
    'migrate:assessment',
    'migrate:control',
    'close:log',
    'close:control',
    'close:assessment',
  ]);
});

test('fresh assessment schemas create students before practice submissions', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src', 'server', 'db', 'postgres.ts'),
    'utf8',
  );
  const students = [...source.matchAll(/CREATE TABLE IF NOT EXISTS students/g)].map((match) => match.index || 0);
  const submissions = [...source.matchAll(/CREATE TABLE IF NOT EXISTS practice_submissions/g)]
    .map((match) => match.index || 0);
  assert.equal(students.length, 2);
  assert.equal(submissions.length, 2);
  assert.ok(students.every((position, index) => position < submissions[index]));
});

test('assessment ownership constraints reference tenant-local admin_users after identity migration', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src', 'server', 'db', 'postgres.ts'),
    'utf8',
  );

  assert.match(source, /ADD COLUMN IF NOT EXISTS uploaded_by INTEGER/);
  assert.match(source, /ADD COLUMN IF NOT EXISTS created_by INTEGER/);
  assert.match(source, /ADD CONSTRAINT question_bank_uploaded_by_fkey/);
  assert.match(source, /ADD CONSTRAINT batches_created_by_fkey/);
  assert.match(source, /REFERENCES admin_users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(source, /DROP COLUMN (?:uploaded_by|created_by)/);
});
