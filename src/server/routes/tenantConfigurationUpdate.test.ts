import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const routeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/routes/tenants.ts'),
  'utf8',
);

function section(start: string, end: string): string {
  const startIndex = routeSource.indexOf(start);
  const endIndex = routeSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing route marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing route marker: ${end}`);
  return routeSource.slice(startIndex, endIndex);
}

test('tenant create, draft update, and approval use explicit validation phases', () => {
  const createRoute = section("router.post('/', requireSuperAdmin", "router.put('/:id'");
  const updateRoute = section("router.put('/:id'", "router.post('/:id/approve'");
  const approvalRoute = section("router.post('/:id/approve'", "router.post('/:id/suspend'");

  assert.match(createRoute, /validateTenantInput\(input,\s*'create'\)/);
  assert.match(updateRoute, /validateTenantInput\(input,\s*'update'\)/);
  assert.match(approvalRoute, /validateTenantInput\([^;]+,\s*'approval'\)/);

  assert.match(updateRoute, /input\.slug\s*=\s*existing\.slug/);
  assert.match(updateRoute, /status\s*=\s*'pending'/);
  assert.match(updateRoute, /provision_status\s*=\s*'not_started'/);
  assert.match(updateRoute, /tenant\.configuration_updated/);
});
