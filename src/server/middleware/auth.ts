import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { RecordMode, parseAllowedRecordModes } from '../services/recordingPolicy.js';
import { getCurrentTenantConfig } from '../tenantContext.js';
import db from '../db/controlPlane.js';
import { IdentityMode, normalizeIdentityMode } from '../services/identityPolicy.js';

export interface AdminUser {
  id: number;
  username: string;
  role: string;
  tenantId?: number | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  /**
   * Chế độ ghi màn hình tenant được phép dùng, nạp từ control-plane mỗi request.
   * Route trong data-plane KHÔNG được tự truy vấn bảng tenants (vi phạm ranh giới
   * giữa hai plane) — đọc giá trị này thay vì mở kết nối chéo.
   */
  allowedRecordModes?: RecordMode[];
  emailEnabled?: boolean;
  emailFromName?: string | null;
  emailDailyLimit?: number;
  identityVerification?: IdentityMode;
  identityRetentionDays?: number | null;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error('[Auth] JWT_SECRET is not configured!');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let payload: AdminUser;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AdminUser;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token expired' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.role, u.tenant_id, t.slug AS tenant_slug,
              t.name AS tenant_name, t.status AS tenant_status,
              t.allowed_record_modes AS tenant_allowed_record_modes,
              t.email_enabled AS tenant_email_enabled,
              t.email_from_name AS tenant_email_from_name,
              t.email_daily_limit AS tenant_email_daily_limit
              , t.identity_verification AS tenant_identity_verification
              , t.identity_retention_days AS tenant_identity_retention_days
       FROM admin_users u LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ?`,
      [payload.id],
    );
    const current = result.rows[0];
    if (!current || current.username !== payload.username) {
      return res.status(401).json({ error: 'Unauthorized: Account no longer exists' });
    }

    const tenantId = current.tenant_id ? Number(current.tenant_id) : null;
    const tenantSlug = current.tenant_slug ? String(current.tenant_slug) : null;
    const isSuperAdmin = current.role === 'superadmin';
    if (!isSuperAdmin && (!tenantId || !tenantSlug)) {
      return res.status(403).json({ error: 'Account is not assigned to a tenant' });
    }
    if (!isSuperAdmin && current.tenant_status === 'suspended') {
      return res.status(403).json({ error: 'Tenant access is suspended' });
    }
    if (payload.role !== current.role || Number(payload.tenantId || 0) !== Number(tenantId || 0)) {
      return res.status(401).json({ error: 'Unauthorized: Session permissions changed. Sign in again.' });
    }

    req.adminUser = {
      id: Number(current.id),
      username: String(current.username),
      role: String(current.role),
      tenantId: isSuperAdmin ? null : tenantId,
      tenantSlug: isSuperAdmin ? null : tenantSlug,
      tenantName: isSuperAdmin ? null : String(current.tenant_name),
      // Superadmin không thuộc tenant nào nên không có allowlist; route assessment
      // của nó vốn đã bị chặn ở tầng khác.
      allowedRecordModes: isSuperAdmin
        ? undefined
        : parseAllowedRecordModes(current.tenant_allowed_record_modes),
      emailEnabled: isSuperAdmin ? undefined : Boolean(current.tenant_email_enabled),
      emailFromName: isSuperAdmin ? undefined : current.tenant_email_from_name,
      emailDailyLimit: isSuperAdmin ? undefined : Number(current.tenant_email_daily_limit || 200),
      identityVerification: isSuperAdmin ? undefined : normalizeIdentityMode(current.tenant_identity_verification),
      identityRetentionDays: isSuperAdmin ? undefined
        : current.tenant_identity_retention_days == null ? null : Number(current.tenant_identity_retention_days),
    };
    next();
  } catch (error) {
    console.error('[Auth] Session lookup failed:', error);
    return res.status(500).json({ error: 'Server authentication error' });
  }
}

// Chỉ cho phép role 'superadmin' — dùng sau authMiddleware, cho các route quản lý user
// và các thao tác đặc quyền khác (vd bật ghi màn hình lên S3).
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.adminUser?.role !== 'superadmin') {
    console.warn('[Security] Blocked superadmin action', { userId: req.adminUser?.id, role: req.adminUser?.role });
    return res.status(403).json({ error: 'Forbidden: Superadmin access required' });
  }
  next();
}

export function requireTenantDataAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.adminUser;
  const isTenantRole = user?.role === 'admin' || user?.role === 'tenant_admin';
  const isCurrentTenantAdmin = isTenantRole
    && Boolean(user.tenantId)
    && user.tenantSlug === getCurrentTenantConfig().slug;
  if (!isCurrentTenantAdmin) {
    console.warn('[Security] Blocked tenant data action', {
      userId: user?.id,
      role: user?.role,
      tenantSlug: user?.tenantSlug,
      serverTenant: getCurrentTenantConfig().slug,
    });
    return res.status(403).json({ error: 'Forbidden: Current tenant administrator access required' });
  }
  next();
}

export function requireTenantUserManager(req: Request, res: Response, next: NextFunction) {
  const user = req.adminUser;
  if (user?.role !== 'tenant_admin'
      || !user.tenantId
      || user.tenantSlug !== getCurrentTenantConfig().slug) {
    console.warn('[Security] Blocked tenant user-management action', {
      userId: user?.id,
      role: user?.role,
      tenantSlug: user?.tenantSlug,
    });
    return res.status(403).json({ error: 'Forbidden: Tenant administrator access required' });
  }
  next();
}

export function requireTenantLogManager(req: Request, res: Response, next: NextFunction) {
  const user = req.adminUser;
  if (user?.role !== 'tenant_admin'
      || !user.tenantId
      || user.tenantSlug !== getCurrentTenantConfig().slug) {
    console.warn('[Security] Blocked tenant log-management action', {
      userId: user?.id,
      role: user?.role,
      tenantSlug: user?.tenantSlug,
    });
    return res.status(403).json({ error: 'Forbidden: Tenant log administrator access required' });
  }
  next();
}

// Compatibility export for older imports. Its semantics intentionally exclude
// superadmin: global control operators must never access tenant assessment data.
export const requirePlatformAdmin = requireTenantDataAdmin;
