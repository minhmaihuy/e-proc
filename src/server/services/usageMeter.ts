import controlDb from '../db/controlPlane.js';
import { getCurrentTenantConfig } from '../tenantContext.js';

export const USAGE_METRICS = ['exams_started', 'ai_gradings', 'recording_minutes', 'emails_sent', 'code_runs'] as const;
export type UsageMetric = typeof USAGE_METRICS[number];

export function usagePeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function validUsageAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function recordUsageEvent(
  eventKey: string,
  metric: UsageMetric,
  amount = 1,
  date = new Date(),
): Promise<boolean> {
  if (!/^[A-Za-z0-9:_.-]{3,140}$/.test(eventKey) || !USAGE_METRICS.includes(metric) || !validUsageAmount(amount)) {
    throw new Error('Invalid usage event.');
  }
  const tenantSlug = getCurrentTenantConfig().slug;
  const tenant = (await controlDb.query('SELECT id FROM tenants WHERE slug = ?', [tenantSlug])).rows[0];
  if (!tenant) throw new Error('Current tenant is not registered in the control plane.');
  const period = usagePeriod(date);
  const scopedEventKey = `${tenantSlug}:${eventKey}`;
  return controlDb.withTransaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO tenant_usage_events (event_key, tenant_id, period_month, metric, amount)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_key) DO NOTHING`,
      [scopedEventKey, Number(tenant.id), period, metric, amount],
    );
    if (inserted.rowCount > 0) {
      await tx.query(
        `INSERT INTO tenant_usage (tenant_id, period_month, ${metric}) VALUES (?, ?, ?)
         ON CONFLICT (tenant_id, period_month) DO UPDATE SET
           ${metric} = tenant_usage.${metric} + ?, updated_at = CURRENT_TIMESTAMP`,
        [Number(tenant.id), period, amount, amount],
      );
      return true;
    }
    // A duplicate retry also repairs an aggregate that was changed out-of-band.
    const total = Number((await tx.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM tenant_usage_events
       WHERE tenant_id = ? AND period_month = ? AND metric = ?`,
      [Number(tenant.id), period, metric],
    )).rows[0]?.total || 0);
    await tx.query(
      `INSERT INTO tenant_usage (tenant_id, period_month, ${metric}) VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, period_month) DO UPDATE SET ${metric} = ?, updated_at = CURRENT_TIMESTAMP`,
      [Number(tenant.id), period, total, total],
    );
    return false;
  });
}
