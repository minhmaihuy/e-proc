import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { recordTenantIssue, IssueActorType, IssueSeverity, TenantIssueInput } from '../db/logPlane.js';
import { getCurrentTenantConfig } from '../tenantContext.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

function actorFromRequest(req: Request): { type: IssueActorType; id: number | null } {
  if (req.adminUser) return { type: 'admin', id: req.adminUser.id };
  if (req.studentPayload) return { type: 'student', id: req.studentPayload.studentId };
  return { type: 'anonymous', id: null };
}

function severityForStatus(status: number): IssueSeverity {
  if (status >= 500) return 'error';
  return 'warning';
}

export function tenantIssueRequestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const issue = buildTenantHttpIssue(req, res.statusCode, requestId);
    if (!issue) return;
    void recordTenantIssue(issue).catch((error) => {
      console.error('[IssueLog] Failed to persist tenant issue:', error instanceof Error ? error.message : 'unknown error');
    });
  });

  next();
}

export function buildTenantHttpIssue(req: Request, statusCode: number, requestId: string): TenantIssueInput | null {
  const isControlRoute = req.path === '/api/tenants' || req.path.startsWith('/api/tenants/');
  if (statusCode < 400 || isControlRoute || req.adminUser?.role === 'superadmin') return null;
  const currentTenant = getCurrentTenantConfig();
  const actor = actorFromRequest(req);
  return {
    tenantSlug: currentTenant.slug,
    severity: severityForStatus(statusCode),
    source: 'http',
    code: `HTTP_${statusCode}`,
    message: `${req.method} ${req.path} returned HTTP ${statusCode}`,
    httpStatus: statusCode,
    httpMethod: req.method,
    requestPath: req.path,
    requestId,
    actorType: actor.type,
    actorId: actor.id,
    metadata: null,
  };
}
