import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminAuthenticationError,
  AdminLoginPrincipal,
  assertLoginScope,
} from './adminAuthentication.js';

const serverTenant = {
  slug: 'fsa-cls',
  name: 'FSA CLS',
  contactEmail: 'admin@fsa-cls.local',
  awsRegion: 'ap-southeast-1',
  domainName: 'epoc.devfasttrack.com',
  appUrl: 'https://epoc.devfasttrack.com/',
};

function principal(overrides: Partial<AdminLoginPrincipal> = {}): AdminLoginPrincipal {
  return {
    id: 7,
    username: 'operator',
    password_hash: 'hashed-value',
    role: 'tenant_admin',
    tenant_id: 1,
    tenant_slug: 'fsa-cls',
    tenant_name: 'FSA CLS',
    tenant_status: 'approved',
    tenant_app_url: 'https://epoc.devfasttrack.com/',
    ...overrides,
  };
}

function expectDenied(action: () => void, status: number, message: RegExp) {
  assert.throws(action, (error: unknown) => (
    error instanceof AdminAuthenticationError
      && error.status === status
      && message.test(error.message)
  ));
}

test('tenant-admin login accepts matching admin roles', () => {
  assert.doesNotThrow(() => assertLoginScope(principal({ role: 'admin' }), 'tenant-admin', serverTenant));
  assert.doesNotThrow(() => assertLoginScope(principal({ role: 'tenant_admin' }), 'tenant-admin', serverTenant));
});

test('tenant-admin login rejects superadmin, unassigned, suspended, and cross-tenant accounts', () => {
  expectDenied(
    () => assertLoginScope(principal({ role: 'superadmin', tenant_id: null, tenant_slug: null }), 'tenant-admin', serverTenant),
    403,
    /tenant\/login/,
  );
  expectDenied(
    () => assertLoginScope(principal({ tenant_id: null, tenant_slug: null }), 'tenant-admin', serverTenant),
    403,
    /not assigned/,
  );
  expectDenied(
    () => assertLoginScope(principal({ tenant_status: 'suspended' }), 'tenant-admin', serverTenant),
    403,
    /suspended/,
  );
  expectDenied(
    () => assertLoginScope(principal({ tenant_slug: 'acme-vietnam', tenant_app_url: 'https://epoc.acme-vietnam.devfasttrack.com/' }), 'tenant-admin', serverTenant),
    403,
    /epoc\.acme-vietnam\.devfasttrack\.com/,
  );
});

test('tenant-control login accepts only superadmin', () => {
  assert.doesNotThrow(() => assertLoginScope(
    principal({ role: 'superadmin', tenant_id: null, tenant_slug: null, tenant_name: null }),
    'tenant-control',
    serverTenant,
  ));
  expectDenied(
    () => assertLoginScope(principal({ role: 'tenant_admin' }), 'tenant-control', serverTenant),
    403,
    /https:\/\/epoc\.devfasttrack\.com\/admin\/login/,
  );
  expectDenied(
    () => assertLoginScope(principal({ role: 'auditor' }), 'tenant-control', serverTenant),
    403,
    /admin\/login/,
  );
  expectDenied(
    () => assertLoginScope(principal({ role: 'superadmin' }), 'tenant-control', serverTenant),
    403,
    /remain global/,
  );
});
