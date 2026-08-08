import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TenantLogAccessError,
  extractLogDatabaseUrl,
  readTenantIssues,
} from './tenantLogReader.js';
import {
  TenantIssueFilterError,
  buildTenantIssueStatusUpdate,
  parseTenantIssueFilters,
  parseTenantIssueStatus,
} from './tenantIssueQuery.js';

const remoteTarget = {
  slug: 'acme-vietnam',
  awsRegion: 'ap-southeast-1',
  secretArn: 'arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc-acme',
};

test('tenant issue filters reject unbounded and unknown values', () => {
  assert.throws(() => parseTenantIssueFilters({ status: 'deleted' }), TenantIssueFilterError);
  assert.throws(() => parseTenantIssueFilters({ severity: 'debug' }), TenantIssueFilterError);
  assert.throws(() => parseTenantIssueFilters({ limit: '201' }), TenantIssueFilterError);
  assert.deepEqual(parseTenantIssueFilters({ status: 'open', severity: 'critical', limit: '20' }), {
    status: 'open',
    severity: 'critical',
    limit: 20,
  });
  assert.equal(parseTenantIssueStatus('archived'), 'archived');
  assert.throws(() => parseTenantIssueStatus('deleted'), TenantIssueFilterError);
});

test('tenant issue lifecycle updates are immutable-content and tenant scoped', () => {
  const resolved = buildTenantIssueStatusUpdate('resolved', 7, 11, 'fsa-cls');
  assert.match(resolved.text, /WHERE id = \? AND tenant_slug = \?/);
  assert.doesNotMatch(resolved.text, /message\s*=/);
  assert.deepEqual(resolved.params, [7, 7, 11, 'fsa-cls']);

  const reopened = buildTenantIssueStatusUpdate('open', 7, 11, 'fsa-cls');
  assert.match(reopened.text, /status = 'open'/);
  assert.match(reopened.text, /resolved_by = NULL/);
  assert.deepEqual(reopened.params, [7, 11, 'fsa-cls']);

  const archived = buildTenantIssueStatusUpdate('archived', 7, 11, 'fsa-cls');
  assert.match(archived.text, /archived_by = \?/);
  assert.deepEqual(archived.params, [7, 7, 11, 'fsa-cls']);
  assert.throws(
    () => buildTenantIssueStatusUpdate('open', 7, 11, '../../other'),
    TenantIssueFilterError,
  );
});

test('current tenant observation uses the local log plane and trusted slug', async () => {
  let observedParams: Array<string | number> = [];
  const issues = await readTenantIssues(
    { ...remoteTarget, slug: 'fsa-cls' },
    { status: 'open', limit: 10 },
    {
      currentTenantSlug: () => 'fsa-cls',
      localQuery: async (sql, params = []) => {
        assert.match(sql, /tenant_slug = \?/);
        observedParams = params;
        return { rows: [{
          id: 7,
          tenant_slug: 'fsa-cls',
          severity: 'error',
          source: 'http',
          code: 'HTTP_500',
          message: 'Request failed',
          http_status: 500,
          http_method: 'GET',
          request_path: '/api/admin/dashboard',
          request_id: 'req-7',
          actor_type: 'admin',
          actor_id: 2,
          metadata_json: '{"safe":true}',
          status: 'open',
          resolved_by: null,
          resolved_at: null,
          created_at: '2026-08-08T00:00:00.000Z',
        }] };
      },
    },
  );
  assert.deepEqual(observedParams, ['fsa-cls', 'open', 10]);
  assert.equal(issues[0].tenant_slug, 'fsa-cls');
  assert.deepEqual(issues[0].metadata, { safe: true });
});

test('remote tenant observation reads the secret, scopes the query, and closes the pool', async () => {
  let closed = false;
  let secretRequest: [string, string] | null = null;
  let connectionSeen = '';
  let queryParams: Array<string | number> = [];
  const issues = await readTenantIssues(remoteTarget, { severity: 'warning', limit: 25 }, {
    currentTenantSlug: () => 'fsa-cls',
    getSecretPayload: async (arn, region) => {
      secretRequest = [arn, region];
      return JSON.stringify({ LOG_DATABASE_URL: 'postgresql://reader:password@logs.example/acme' });
    },
    openRemoteDatabase: async (connectionString) => {
      connectionSeen = connectionString;
      return {
        query: async (sql, params = []) => {
          assert.match(sql, /tenant_slug = \?/);
          assert.match(sql, /severity = \?/);
          queryParams = params;
          return { rows: [] };
        },
        close: async () => { closed = true; },
      };
    },
  });
  assert.deepEqual(secretRequest, [remoteTarget.secretArn, remoteTarget.awsRegion]);
  assert.equal(connectionSeen, 'postgresql://reader:password@logs.example/acme');
  assert.deepEqual(queryParams, ['acme-vietnam', 'warning', 25]);
  assert.equal(closed, true);
  assert.deepEqual(issues, []);
});

test('remote tenant observation closes the pool and returns a safe error when query fails', async () => {
  let closed = false;
  await assert.rejects(
    readTenantIssues(remoteTarget, { limit: 10 }, {
      currentTenantSlug: () => 'fsa-cls',
      getSecretPayload: async () => JSON.stringify({
        LOG_DATABASE_URL: 'postgresql://reader:private-value@logs.example/acme',
      }),
      openRemoteDatabase: async () => ({
        query: async () => { throw new Error('postgresql://reader:private-value@logs.example/acme'); },
        close: async () => { closed = true; },
      }),
    }),
    (error: unknown) => error instanceof TenantLogAccessError
      && error.code === 'UPSTREAM_UNAVAILABLE'
      && !error.message.includes('private-value'),
  );
  assert.equal(closed, true);
});

test('remote log URL must be a PostgreSQL URL from structured secret JSON', () => {
  assert.equal(
    extractLogDatabaseUrl('{"LOG_DATABASE_URL":"postgresql://reader:password@logs.example/acme"}'),
    'postgresql://reader:password@logs.example/acme',
  );
  assert.throws(() => extractLogDatabaseUrl('{"LOG_DATABASE_URL":"sqlite:///tmp/log.db"}'), TenantLogAccessError);
  assert.throws(() => extractLogDatabaseUrl('{"DATABASE_URL":"postgresql://assessment.example/eproc"}'), TenantLogAccessError);
  assert.throws(() => extractLogDatabaseUrl('not-json'), TenantLogAccessError);
});
