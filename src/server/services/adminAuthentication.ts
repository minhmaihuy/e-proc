import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import controlDb from '../db/controlPlane.js';
import { CurrentTenantConfig, getCurrentTenantConfig } from '../tenantContext.js';

export type AdminLoginScope = 'tenant-admin' | 'tenant-control';

export interface AdminLoginPrincipal {
  id: number;
  username: string;
  password_hash: string;
  role?: string | null;
  tenant_id?: number | null;
  tenant_slug?: string | null;
  tenant_name?: string | null;
  tenant_status?: string | null;
  tenant_app_url?: string | null;
}

export interface AdminLoginSession {
  token: string;
  expiresAt: string;
  userId: number;
  role: string;
  tenantId: number | null;
  tenantSlug: string | null;
  tenantName: string | null;
  serverTenantSlug: string;
  serverTenantName: string;
}

export class AdminAuthenticationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AdminAuthenticationError';
  }
}

export function assertLoginScope(
  user: AdminLoginPrincipal,
  scope: AdminLoginScope,
  serverTenant: CurrentTenantConfig,
): void {
  const role = user.role || 'admin';
  const tenantId = user.tenant_id ? Number(user.tenant_id) : null;

  if (scope === 'tenant-control') {
    if (role !== 'superadmin') {
      const tenantAdminLogin = user.tenant_app_url
        ? `${String(user.tenant_app_url).replace(/\/+$/, '')}/admin/login`
        : '';
      throw new AdminAuthenticationError(
        403,
        tenantAdminLogin
          ? `Tenant accounts must sign in at ${tenantAdminLogin}.`
          : 'Tenant accounts must use /admin/login on their tenant application.',
      );
    }
    if (tenantId || user.tenant_slug) {
      throw new AdminAuthenticationError(403, 'Superadmin account must remain global.');
    }
    return;
  }

  if (role === 'superadmin') {
    throw new AdminAuthenticationError(403, 'Superadmin accounts must use /tenant/login.');
  }
  if (role !== 'admin' && role !== 'tenant_admin') {
    throw new AdminAuthenticationError(403, 'Account role is not permitted for tenant administration.');
  }
  if (!tenantId || !user.tenant_slug) {
    throw new AdminAuthenticationError(403, 'Account is not assigned to a tenant. Contact the superadmin.');
  }
  if (user.tenant_status === 'suspended') {
    throw new AdminAuthenticationError(403, 'Tenant access is suspended.');
  }
  if (user.tenant_slug !== serverTenant.slug) {
    throw new AdminAuthenticationError(
      403,
      user.tenant_app_url
        ? `Use your tenant application to sign in: ${user.tenant_app_url}`
        : 'Use your tenant application to sign in.',
    );
  }
}

function validateCredentialsInput(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    throw new AdminAuthenticationError(400, 'Username and password are required');
  }
  const normalizedUsername = username.trim();
  if (normalizedUsername.length > 100 || password.length > 128) {
    throw new AdminAuthenticationError(400, 'Invalid login request');
  }
  return { username: normalizedUsername, password };
}

export async function authenticateAdmin(
  usernameInput: unknown,
  passwordInput: unknown,
  scope: AdminLoginScope,
): Promise<AdminLoginSession> {
  const { username, password } = validateCredentialsInput(usernameInput, passwordInput);
  const result = await controlDb.query(
    `SELECT u.*, t.slug AS tenant_slug, t.name AS tenant_name, t.status AS tenant_status,
            t.app_url AS tenant_app_url
     FROM admin_users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.username = ?`,
    [username],
  );
  const user = result.rows[0] as AdminLoginPrincipal | undefined;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AdminAuthenticationError(401, 'Invalid username or password');
  }

  const serverTenant = getCurrentTenantConfig();
  assertLoginScope(user, scope, serverTenant);

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AdminAuthenticationError(500, 'Server configuration error');

  const role = user.role || 'admin';
  const isSuperAdmin = role === 'superadmin';
  const tenantId = isSuperAdmin ? null : Number(user.tenant_id);
  const tenantSlug = isSuperAdmin ? null : String(user.tenant_slug);
  const tenantName = isSuperAdmin ? null : String(user.tenant_name);
  const token = jwt.sign(
    { id: user.id, username: user.username, role, tenantId, tenantSlug, tenantName },
    secret,
    { algorithm: 'HS256', expiresIn: '24h' },
  );

  return {
    token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    userId: Number(user.id),
    role,
    tenantId,
    tenantSlug,
    tenantName,
    serverTenantSlug: serverTenant.slug,
    serverTenantName: serverTenant.name,
  };
}

export async function changeAdminPassword(
  userId: number,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<void> {
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    throw new AdminAuthenticationError(400, 'currentPassword and newPassword are required');
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new AdminAuthenticationError(400, 'New password must be 8-128 characters');
  }

  const result = await controlDb.query('SELECT password_hash FROM admin_users WHERE id = ?', [userId]);
  const user = result.rows[0] as Pick<AdminLoginPrincipal, 'password_hash'> | undefined;
  if (!user) throw new AdminAuthenticationError(404, 'User not found');
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new AdminAuthenticationError(401, 'Current password is incorrect');
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await controlDb.query(
    'UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newHash, userId],
  );
}
