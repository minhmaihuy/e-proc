import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DatabaseBootstrapError,
  DatabaseMaintenanceClient,
  buildDatabaseBootstrapPlan,
  ensurePostgresDatabases,
  quotePostgresIdentifier,
} from './databaseBootstrap.js';

const validEnvironment = {
  DATABASE_URL: 'postgresql://app:test-only@db.example/eaudit',
  CONTROL_DATABASE_URL: 'postgresql://app:test-only@db.example/eaudit_control',
  LOG_DATABASE_URL: 'postgresql://app:test-only@db.example/eaudit_fsa_cls_logs',
};

test('bootstrap plan accepts three isolated databases on one PostgreSQL server', () => {
  const plan = buildDatabaseBootstrapPlan(validEnvironment);
  assert.deepEqual(plan.map((target) => target.databaseName), [
    'eaudit',
    'eaudit_control',
    'eaudit_fsa_cls_logs',
  ]);
  assert.ok(plan.every((target) => target.serverLabel === 'db.example:5432'));
  assert.ok(plan.every((target) => new URL(target.maintenanceConnectionString).pathname === '/postgres'));
});

test('bootstrap plan requires all database planes and keeps them isolated', () => {
  assert.throws(
    () => buildDatabaseBootstrapPlan({ ...validEnvironment, CONTROL_DATABASE_URL: '' }),
    (error: unknown) => error instanceof DatabaseBootstrapError
      && error.code === 'MISSING_DATABASE_URL',
  );
  assert.throws(
    () => buildDatabaseBootstrapPlan({
      ...validEnvironment,
      LOG_DATABASE_URL: 'postgresql://other:test-only@db.example/eaudit',
    }),
    (error: unknown) => error instanceof DatabaseBootstrapError
      && error.code === 'DATABASE_PLANES_NOT_ISOLATED',
  );
});

test('bootstrap plan rejects unsupported, unsafe, and system database targets', () => {
  assert.throws(
    () => buildDatabaseBootstrapPlan({ ...validEnvironment, DATABASE_URL: 'sqlite:///eaudit' }),
    (error: unknown) => error instanceof DatabaseBootstrapError
      && error.code === 'UNSUPPORTED_DATABASE_PROTOCOL',
  );
  assert.throws(
    () => buildDatabaseBootstrapPlan({ ...validEnvironment, DATABASE_URL: 'postgresql://db.example/bad%2Fname' }),
    (error: unknown) => error instanceof DatabaseBootstrapError
      && error.code === 'INVALID_DATABASE_NAME',
  );
  assert.throws(
    () => buildDatabaseBootstrapPlan({ ...validEnvironment, DATABASE_URL: 'postgresql://db.example/postgres' }),
    (error: unknown) => error instanceof DatabaseBootstrapError
      && error.code === 'SYSTEM_DATABASE_TARGET',
  );
  assert.throws(() => quotePostgresIdentifier('bad"name'), DatabaseBootstrapError);
});

test('database ensure creates only missing targets and closes every connection', async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const connections: string[] = [];
  let closeCount = 0;
  let targetIndex = 0;

  const results = await ensurePostgresDatabases(validEnvironment, (connectionString) => {
    const currentIndex = targetIndex++;
    connections.push(connectionString);
    const client: DatabaseMaintenanceClient = {
      connect: async () => undefined,
      query: async (text, values) => {
        queries.push({ text, values });
        if (text.startsWith('SELECT')) {
          return { rows: currentIndex === 0 ? [{}] : [] };
        }
        return { rows: [] };
      },
      end: async () => { closeCount += 1; },
    };
    return client;
  });

  assert.deepEqual(results.map((result) => result.created), [false, true, true]);
  assert.equal(queries.filter((query) => query.text.startsWith('CREATE DATABASE')).length, 2);
  assert.equal(closeCount, 3);
  assert.ok(connections.every((connection) => new URL(connection).pathname === '/postgres'));
});

test('database ensure sanitizes failures and still closes the connection', async () => {
  let closed = false;
  await assert.rejects(
    ensurePostgresDatabases(validEnvironment, () => ({
      connect: async () => {
        throw Object.assign(new Error('postgresql://app:private-value@db.example/eaudit'), { code: '28P01' });
      },
      query: async () => ({ rows: [] }),
      end: async () => { closed = true; },
    })),
    (error: unknown) => error instanceof DatabaseBootstrapError
      && error.databaseCode === '28P01'
      && !error.message.includes('private-value'),
  );
  assert.equal(closed, true);
});

test('duplicate database creation race is treated as idempotent success', async () => {
  const results = await ensurePostgresDatabases(validEnvironment, () => ({
    connect: async () => undefined,
    query: async (text) => {
      if (text.startsWith('SELECT')) return { rows: [] };
      throw Object.assign(new Error('duplicate database'), { code: '42P04' });
    },
    end: async () => undefined,
  }));
  assert.deepEqual(results.map((result) => result.created), [false, false, false]);
});
