import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import dataDb from '../db/postgres.js';
import controlDb from '../db/controlPlane.js';
import { getCurrentTenantConfig } from '../tenantContext.js';
import { EmailPayload, EmailTemplate, renderEmail } from './emailPolicy.js';
import { enqueueUsageEvent } from './usageOutbox.js';

let client: SESv2Client | null = null;
let queueProcessing = false;

export function isEmailRecipient(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
}

export function isEmailProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const region = env.AWS_REGION?.trim() || '';
  const topicArn = env.SES_SNS_TOPIC_ARN?.trim() || '';
  const topicMatch = topicArn.match(/^arn:aws(?:-us-gov)?:sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_.-]{1,256}$/);
  return /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/.test(region)
    && isEmailRecipient(env.SES_FROM_EMAIL)
    && topicMatch?.[1] === region
    && /^[A-Za-z0-9_-]{1,64}$/.test(env.SES_CONFIGURATION_SET?.trim() || '');
}

export function sqlTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function emailClient(): SESv2Client {
  if (!process.env.AWS_REGION) throw new Error('AWS_REGION is required for email delivery.');
  if (!client) client = new SESv2Client({ region: process.env.AWS_REGION });
  return client;
}

export async function enqueueEmail(
  dedupeKey: string,
  template: EmailTemplate,
  recipient: string,
  payload: EmailPayload,
): Promise<boolean> {
  const normalizedRecipient = recipient.trim().toLowerCase();
  if (!isEmailRecipient(normalizedRecipient)) throw new Error('Invalid email recipient.');
  const suppressed = await dataDb.query('SELECT recipient FROM email_suppressions WHERE recipient = ?', [normalizedRecipient]);
  if (suppressed.rows.length) return false;
  const result = await dataDb.query(
    `INSERT INTO email_queue (dedupe_key, template, recipient, payload_json)
     VALUES (?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, template, normalizedRecipient, JSON.stringify(payload)],
  );
  return result.rowCount > 0;
}

export async function processEmailQueue(limit = 5): Promise<number> {
  if (queueProcessing || !isEmailProviderConfigured()) return 0;
  queueProcessing = true;
  try {
    const tenant = (await controlDb.query(
      'SELECT id, name, email_enabled, email_from_name, email_daily_limit FROM tenants WHERE slug = ?',
      [getCurrentTenantConfig().slug],
    )).rows[0];
    if (!tenant || !Boolean(tenant.email_enabled)) return 0;
    const dayStart = sqlTimestamp(new Date(new Date().setUTCHours(0, 0, 0, 0)));
    const sentToday = Number((await dataDb.query(
      `SELECT COUNT(*) AS count FROM email_queue
       WHERE (status = 'sent' AND sent_at >= ?) OR (status = 'sending' AND updated_at >= ?)`,
      [dayStart, dayStart],
    )).rows[0]?.count || 0);
    const remaining = Math.max(0, Number(tenant.email_daily_limit || 200) - sentToday);
    if (remaining === 0) return 0;
    const pending = await dataDb.query(
      `SELECT id, dedupe_key, template, recipient, payload_json, attempts FROM email_queue
       WHERE status = 'pending' OR (status = 'sending' AND updated_at < ?)
       ORDER BY created_at LIMIT ?`,
      [sqlTimestamp(new Date(Date.now() - 10 * 60_000)), Math.min(limit, remaining)],
    );
    let sent = 0;
    for (const job of pending.rows) {
      try {
      const claimed = await dataDb.query(
        `UPDATE email_queue SET status = 'sending', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND (status = 'pending' OR (status = 'sending' AND updated_at < ?))`,
        [job.id, sqlTimestamp(new Date(Date.now() - 10 * 60_000))],
      );
      if (claimed.rowCount === 0) continue;
      const suppressed = await dataDb.query('SELECT recipient FROM email_suppressions WHERE recipient = ?', [job.recipient]);
      if (suppressed.rows.length) {
        await dataDb.query("UPDATE email_queue SET status = 'suppressed', error_code = 'SUPPRESSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id]);
        continue;
      }
      const message = renderEmail(job.template as EmailTemplate, JSON.parse(job.payload_json) as EmailPayload);
      const fromName = String(tenant.email_from_name || tenant.name).replace(/[\r\n"<>]/g, '').slice(0, 160);
      const response = await emailClient().send(new SendEmailCommand({
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET!.trim(),
        FromEmailAddress: `"${fromName}" <${process.env.SES_FROM_EMAIL!.trim()}>`,
        Destination: { ToAddresses: [job.recipient] },
        Content: { Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: message.html, Charset: 'UTF-8' },
          },
        } },
      }));
      await dataDb.query(
        "UPDATE email_queue SET status = 'sent', attempts = attempts + 1, error_code = NULL, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [job.id],
      );
      await enqueueUsageEvent(`email:${job.dedupe_key}`, 'emails_sent', 1, new Date()).catch(error => {
        console.error('[Usage] Email outbox enqueue failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
      });
      sent++;
      if (!response.MessageId) console.warn('[Email] SES accepted a message without returning an id.');
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        await dataDb.query(
          `UPDATE email_queue SET status = ?, attempts = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [attempts >= 3 ? 'failed' : 'pending', attempts, error instanceof Error ? error.name.slice(0, 64) : 'UnknownError', job.id],
        );
      }
    }
    return sent;
  } finally {
    queueProcessing = false;
  }
}

export async function suppressRecipient(recipient: string, reason: 'bounce' | 'complaint', eventId: string): Promise<void> {
  const normalized = recipient.trim().toLowerCase();
  if (!isEmailRecipient(normalized)) return;
  await dataDb.query(
    `INSERT INTO email_suppressions (recipient, reason, provider_event_id) VALUES (?, ?, ?)
     ON CONFLICT (recipient) DO UPDATE SET reason = ?, provider_event_id = ?, created_at = CURRENT_TIMESTAMP`,
    [normalized, reason, eventId.slice(0, 180), reason, eventId.slice(0, 180)],
  );
}
