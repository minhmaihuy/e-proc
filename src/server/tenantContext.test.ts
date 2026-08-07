import test from 'node:test';
import assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { requirePlatformAdmin } from './middleware/auth.js';
import { canManageTenantUser, getCurrentTenantConfig } from './tenantContext.js';

test('tenant context defaults legacy installations to FSA', () => {
  const context = getCurrentTenantConfig({});
  assert.equal(context.slug, 'fsa');
  assert.equal(context.name, 'FSA');
  assert.equal(context.contactEmail, 'admin@fsa.local');
});

test('tenant context reads the provisioned tenant identity safely', () => {
  const context = getCurrentTenantConfig({
    TENANT_SLUG: 'acme-vietnam',
    DEFAULT_TENANT_NAME_B64: Buffer.from('Acme Vietnam').toString('base64'),
    DEFAULT_TENANT_CONTACT_EMAIL_B64: Buffer.from('admin@acme.example').toString('base64'),
    DEFAULT_TENANT_APP_URL: 'https://acme.example',
  });
  assert.deepEqual(context, {
    slug: 'acme-vietnam',
    name: 'Acme Vietnam',
    contactEmail: 'admin@acme.example',
    awsRegion: 'ap-southeast-1',
    domainName: '',
    appUrl: 'https://acme.example',
  });
});

test('tenant user policy blocks cross-tenant and superadmin targets', () => {
  const actor = { role: 'tenant_admin', tenantId: 10 };
  assert.equal(canManageTenantUser(actor, { role: 'admin', tenantId: 10 }), true);
  assert.equal(canManageTenantUser(actor, { role: 'admin', tenantId: 11 }), false);
  assert.equal(canManageTenantUser(actor, { role: 'superadmin', tenantId: null }), false);
  assert.equal(canManageTenantUser({ role: 'superadmin' }, { role: 'tenant_admin', tenantId: 11 }), true);
});

function invokePlatformGuard(adminUser: Request['adminUser']) {
  let nextCalled = false;
  let statusCode = 200;
  const req = { adminUser } as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  requirePlatformAdmin(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode };
}

test('platform guard accepts only superadmin or an admin from the current server tenant', () => {
  const previousTenantSlug = process.env.TENANT_SLUG;
  process.env.TENANT_SLUG = 'fsa';
  try {
    assert.equal(invokePlatformGuard({ id: 1, username: 'root', role: 'superadmin' }).nextCalled, true);
    assert.equal(invokePlatformGuard({ id: 2, username: 'fsa-admin', role: 'admin', tenantId: 1, tenantSlug: 'fsa' }).nextCalled, true);
    assert.equal(invokePlatformGuard({ id: 3, username: 'other', role: 'admin', tenantId: 2, tenantSlug: 'other' }).statusCode, 403);
    assert.equal(invokePlatformGuard({ id: 4, username: 'legacy', role: 'admin' }).statusCode, 403);
  } finally {
    if (previousTenantSlug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = previousTenantSlug;
  }
});
