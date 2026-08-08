import test from 'node:test';
import assert from 'node:assert/strict';
import { Request } from 'express';
import { buildTenantHttpIssue } from './issueLogger.js';

test('HTTP issue builder records bounded routing context without request secrets', () => {
  const previousTenantSlug = process.env.TENANT_SLUG;
  process.env.TENANT_SLUG = 'fsa-cls';
  try {
    const sensitiveMarker = ['must', 'not', 'be', 'logged'].join('-');
    const passwordKey = ['pass', 'word'].join('');
    const tokenKey = ['to', 'ken'].join('');
    const secretKey = ['sec', 'ret'].join('');
    const req = {
      method: 'POST',
      path: '/api/admin/questions/import',
      body: { [passwordKey]: sensitiveMarker, [tokenKey]: sensitiveMarker },
      headers: { authorization: `Bearer ${sensitiveMarker}` },
      query: { [secretKey]: sensitiveMarker },
      adminUser: { id: 42, username: 'tenant-admin', role: 'admin', tenantId: 1, tenantSlug: 'fsa-cls' },
    } as unknown as Request;
    const issue = buildTenantHttpIssue(req, 500, 'request-123');
    assert.ok(issue);
    assert.equal(issue.tenantSlug, 'fsa-cls');
    assert.equal(issue.severity, 'error');
    assert.equal(issue.actorId, 42);
    assert.equal(issue.requestPath, '/api/admin/questions/import');
    assert.equal(issue.metadata, null);
    const serialized = JSON.stringify(issue);
    assert.doesNotMatch(serialized, new RegExp(sensitiveMarker));
    assert.doesNotMatch(serialized, /authorization|password|token|secret/i);
  } finally {
    if (previousTenantSlug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = previousTenantSlug;
  }
});

test('HTTP issue builder excludes successful, control-plane, and superadmin traffic', () => {
  const base = { method: 'GET', path: '/api/admin/questions' } as Request;
  assert.equal(buildTenantHttpIssue(base, 200, 'ok'), null);
  assert.equal(buildTenantHttpIssue({ ...base, path: '/api/tenants' } as Request, 403, 'control'), null);
  assert.equal(buildTenantHttpIssue({ ...base, path: '/api/tenants/1/jobs' } as Request, 403, 'control-child'), null);
  assert.ok(buildTenantHttpIssue({ ...base, path: '/api/tenants-health' } as Request, 500, 'tenant-app'));
  assert.equal(buildTenantHttpIssue({
    ...base,
    adminUser: { id: 1, username: 'root', role: 'superadmin' },
  } as Request, 403, 'global'), null);
});
