import dataDb from '../db/postgres.js';
import { recordUsageEvent, UsageMetric } from './usageMeter.js';

export function usageEventDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid usage event timestamp.');
  return date;
}

export async function enqueueUsageEvent(
  eventKey: string,
  metric: UsageMetric,
  amount = 1,
  occurredAt = new Date(),
): Promise<void> {
  await dataDb.query(
    `INSERT INTO usage_outbox (event_key, metric, amount, occurred_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (event_key) DO NOTHING`,
    [eventKey, metric, amount, usageEventDate(occurredAt).toISOString()],
  );
}

/** Rebuild durable events derivable from assessment state before delivering them. */
export async function reconcileUsageOutbox(): Promise<void> {
  const exams = await dataDb.query('SELECT id, exam_started_at FROM students WHERE exam_started_at IS NOT NULL');
  for (const row of exams.rows) {
    await enqueueUsageEvent(`exam-start:${row.id}`, 'exams_started', 1, usageEventDate(row.exam_started_at));
  }

  const recordings = await dataDb.query(
    'SELECT id, exam_started_at, recording_finalized_at FROM students WHERE exam_started_at IS NOT NULL AND recording_finalized_at IS NOT NULL',
  );
  for (const row of recordings.rows) {
    const minutes = Math.max(1, (new Date(row.recording_finalized_at).getTime() - new Date(row.exam_started_at).getTime()) / 60_000);
    await enqueueUsageEvent(`recording:${row.id}`, 'recording_minutes', minutes, usageEventDate(row.recording_finalized_at));
  }

  const sentEmails = await dataDb.query("SELECT dedupe_key, sent_at FROM email_queue WHERE status = 'sent' AND sent_at IS NOT NULL");
  for (const row of sentEmails.rows) {
    await enqueueUsageEvent(`email:${row.dedupe_key}`, 'emails_sent', 1, usageEventDate(row.sent_at));
  }
}

export async function processUsageOutbox(limit = 50): Promise<number> {
  await reconcileUsageOutbox();
  const pending = await dataDb.query(
    "SELECT event_key, metric, amount, occurred_at FROM usage_outbox WHERE status = 'pending' ORDER BY created_at LIMIT ?",
    [limit],
  );
  let processed = 0;
  for (const row of pending.rows) {
    try {
      await recordUsageEvent(
        String(row.event_key),
        row.metric as UsageMetric,
        Number(row.amount),
        usageEventDate(row.occurred_at),
      );
      await dataDb.query(
        "UPDATE usage_outbox SET status = 'recorded', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?",
        [row.event_key],
      );
      processed++;
    } catch (error) {
      await dataDb.query(
        'UPDATE usage_outbox SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?',
        [row.event_key],
      ).catch(() => undefined);
      console.error('[Usage] Outbox delivery failed', { metric: row.metric, errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
  return processed;
}
