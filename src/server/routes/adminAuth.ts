import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, requireTenantDataAdmin } from '../middleware/auth.js';
import {
  AdminAuthenticationError,
  authenticateAdmin,
  changeAdminPassword,
} from '../services/adminAuthentication.js';

const router = Router();
const loginRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function sendAuthenticationError(res: Response, error: unknown, fallback: string) {
  if (error instanceof AdminAuthenticationError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`[Tenant admin auth] ${fallback}`);
  return res.status(500).json({ error: fallback });
}

router.post('/login', loginRateLimit, async (req: Request, res: Response) => {
  try {
    const session = await authenticateAdmin(req.body?.username, req.body?.password, 'tenant-admin');
    console.log('[Auth] Tenant admin login success:', session.userId, 'tenant:', session.tenantSlug);
    return res.json(session);
  } catch (error) {
    return sendAuthenticationError(res, error, 'Login failed');
  }
});

router.post('/logout', (_req: Request, res: Response) => res.json({ success: true }));

router.put('/change-password', authMiddleware, requireTenantDataAdmin, async (req: Request, res: Response) => {
  try {
    await changeAdminPassword(req.adminUser!.id, req.body?.currentPassword, req.body?.newPassword, 'tenant-admin');
    console.log('[Auth] Tenant admin password changed:', req.adminUser!.id);
    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    return sendAuthenticationError(res, error, 'Failed to change password');
  }
});

export default router;
