import { Request, Response, Router } from 'express';
import logDb from '../db/logPlane.js';
import { authMiddleware, requireTenantDataAdmin, requireTenantLogManager } from '../middleware/auth.js';
import {
  TenantIssueFilterError,
  buildTenantIssueStatusUpdate,
  listTenantIssues,
  parseTenantIssueFilters,
  parseTenantIssueStatus,
  TenantIssueStatus,
} from '../services/tenantIssueQuery.js';

const router = Router();
router.use(authMiddleware, requireTenantDataAdmin);

router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = parseTenantIssueFilters(req.query as Record<string, unknown>);
    const issues = await listTenantIssues(
      (text, params = []) => logDb.query(text, params),
      req.adminUser!.tenantSlug!,
      filters,
    );
    return res.json(issues);
  } catch (error) {
    if (error instanceof TenantIssueFilterError) return res.status(400).json({ error: error.message });
    console.error('[Issues] List failed:', error);
    return res.status(500).json({ error: 'Failed to load tenant issues.' });
  }
});

async function updateIssueStatus(req: Request, res: Response, requestedStatus?: TenantIssueStatus) {
  try {
    const issueId = Number(req.params.id);
    if (!Number.isInteger(issueId) || issueId <= 0) return res.status(400).json({ error: 'Invalid issue ID.' });
    const status = requestedStatus || parseTenantIssueStatus(req.body?.status);
    const actorId = req.adminUser!.id;
    const update = buildTenantIssueStatusUpdate(status, actorId, issueId, req.adminUser!.tenantSlug!);
    const result = await logDb.query(update.text, update.params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tenant issue not found.' });
    return res.json({ success: true, status });
  } catch (error) {
    if (error instanceof TenantIssueFilterError) return res.status(400).json({ error: error.message });
    console.error('[Issues] Status update failed:', error);
    return res.status(500).json({ error: 'Failed to update tenant issue.' });
  }
}

router.put('/:id/resolve', requireTenantLogManager, (req, res) => updateIssueStatus(req, res, 'resolved'));
router.put('/:id/status', requireTenantLogManager, (req, res) => updateIssueStatus(req, res));

export default router;
