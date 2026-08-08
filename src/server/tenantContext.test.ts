import test from 'node:test';
import assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { requireTenantDataAdmin, requireTenantLogManager, requireTenantUserManager } from './middleware/auth.js';
import { canManageTenantUser, getCurrentTenantConfig, isTenantDomainForSlug, tenantDomainForSlug } from './tenantContext.js';

test('tenant context binds legacy installations to FSA-CLS', () => {
  const context = getCurrentTenantConfig({});
  assert.equal(context.slug, 'fsa-cls');
  assert.equal(context.name, 'FSA CLS');
  assert.equal(context.contactEmail, 'admin@fsa-cls.local');
  assert.equal(context.domainName, 'epoc.devfasttrack.com');
  assert.equal(context.appUrl, 'https://epoc.devfasttrack.com/');
});

test('tenant context maps an explicit legacy FSA environment to FSA-CLS', () => {
  const context = getCurrentTenantConfig({ TENANT_SLUG: 'fsa' });
  assert.equal(context.slug, 'fsa-cls');
  assert.equal(context.name, 'FSA CLS');
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
    domainName: 'epoc.acme-vietnam.devfasttrack.com',
    appUrl: 'https://acme.example',
  });
});

test('tenant user policy blocks cross-tenant and superadmin targets', () => {
  const actor = { role: 'tenant_admin', tenantId: 10 };
  assert.equal(canManageTenantUser(actor, { role: 'admin', tenantId: 10 }), true);
  assert.equal(canManageTenantUser(actor, { role: 'admin', tenantId: 11 }), false);
  assert.equal(canManageTenantUser(actor, { role: 'superadmin', tenantId: null }), false);
  assert.equal(canManageTenantUser({ role: 'superadmin' }, { role: 'tenant_admin', tenantId: 11 }), false);
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
  requireTenantDataAdmin(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode };
}

test('tenant data guard accepts only admin roles from the current server tenant', () => {
  const previousTenantSlug = process.env.TENANT_SLUG;
  process.env.TENANT_SLUG = 'fsa';
  try {
    assert.equal(invokePlatformGuard({ id: 1, username: 'root', role: 'superadmin' }).statusCode, 403);
    assert.equal(invokePlatformGuard({ id: 2, username: 'fsa-admin', role: 'admin', tenantId: 1, tenantSlug: 'fsa-cls' }).nextCalled, true);
    assert.equal(invokePlatformGuard({ id: 5, username: 'fsa-owner', role: 'tenant_admin', tenantId: 1, tenantSlug: 'fsa-cls' }).nextCalled, true);
    assert.equal(invokePlatformGuard({ id: 3, username: 'other', role: 'admin', tenantId: 2, tenantSlug: 'other' }).statusCode, 403);
    assert.equal(invokePlatformGuard({ id: 4, username: 'legacy', role: 'admin' }).statusCode, 403);
  } finally {
    if (previousTenantSlug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = previousTenantSlug;
  }
});

test('FSA-CLS subdomain takes precedence over a localhost CORS fallback', () => {
  const context = getCurrentTenantConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' });
  assert.equal(context.domainName, 'epoc.devfasttrack.com');
  assert.equal(context.appUrl, 'https://epoc.devfasttrack.com/');
});

test('tenant domains follow the epoc tenant devfasttrack.com convention', () => {
  assert.equal(tenantDomainForSlug('fsa-cls'), 'epoc.devfasttrack.com');
  assert.equal(tenantDomainForSlug('fsa'), 'epoc.devfasttrack.com');
  assert.equal(tenantDomainForSlug('acme-vietnam'), 'epoc.acme-vietnam.devfasttrack.com');
  assert.equal(tenantDomainForSlug('../../other'), '');
  assert.equal(isTenantDomainForSlug('epoc.devfasttrack.com', 'fsa-cls'), true);
  assert.equal(isTenantDomainForSlug('epoc.fsa.devfasttrack.com', 'fsa-cls'), false);
  assert.equal(isTenantDomainForSlug('epoc.other.devfasttrack.com', 'acme-vietnam'), false);
  const legacy = getCurrentTenantConfig({
    TENANT_SLUG: 'fsa-cls',
    DEFAULT_TENANT_DOMAIN: 'epoc-fsa-cls.devfasttrack.cloud',
    DEFAULT_TENANT_APP_URL: 'https://epoc-fsa-cls.devfasttrack.cloud/',
  });
  assert.equal(legacy.domainName, 'epoc.devfasttrack.com');
  assert.equal(legacy.appUrl, 'https://epoc.devfasttrack.com/');
});

test('tenant user guard accepts only the current tenant owner', () => {
  const previousTenantSlug = process.env.TENANT_SLUG;
  process.env.TENANT_SLUG = 'fsa-cls';
  try {
    let nextCalled = false;
    const req = { adminUser: { id: 5, username: 'owner', role: 'tenant_admin', tenantId: 1, tenantSlug: 'fsa-cls' } } as Request;
    const res = { status() { return this; }, json() { return this; } } as unknown as Response;
    requireTenantUserManager(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    assert.equal(invokePlatformGuard({ id: 6, username: 'global', role: 'superadmin' }).statusCode, 403);
  } finally {
    if (previousTenantSlug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = previousTenantSlug;
  }
});

test('tenant log manager guard accepts only matching tenant_admin', () => {
  const previousTenantSlug = process.env.TENANT_SLUG;
  process.env.TENANT_SLUG = 'fsa-cls';
  const invoke = (adminUser: Request['adminUser']) => {
    let nextCalled = false;
    let statusCode = 200;
    const req = { adminUser } as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    } as unknown as Response;
    requireTenantLogManager(req, res, () => { nextCalled = true; });
    return { nextCalled, statusCode };
  };
  try {
    assert.equal(invoke({ id: 1, username: 'owner', role: 'tenant_admin', tenantId: 1, tenantSlug: 'fsa-cls' }).nextCalled, true);
    assert.equal(invoke({ id: 2, username: 'viewer', role: 'admin', tenantId: 1, tenantSlug: 'fsa-cls' }).statusCode, 403);
    assert.equal(invoke({ id: 3, username: 'other', role: 'tenant_admin', tenantId: 2, tenantSlug: 'other' }).statusCode, 403);
    assert.equal(invoke({ id: 4, username: 'global', role: 'superadmin' }).statusCode, 403);
  } finally {
    if (previousTenantSlug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = previousTenantSlug;
  }
});
