import express, { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { suppressRecipient } from '../services/emailDelivery.js';

const router = Router();
router.use(express.text({ type: ['text/plain', 'application/json'], limit: '256kb' }));

function matchesConfiguredTopic(topicArn: string): boolean {
  const configured = process.env.SES_SNS_TOPIC_ARN?.trim();
  if (!configured || !topicArn || configured.length !== topicArn.length) return false;
  return crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(topicArn));
}

function validAwsUrl(value: string, service: 'sns' | 'cert'): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (service === 'cert') return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) && url.pathname.endsWith('.pem');
    return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
  } catch { return false; }
}

function signingText(message: Record<string, string>): string {
  const fields = message.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.filter(field => message[field] != null).map(field => `${field}\n${message[field]}\n`).join('');
}

async function verifySnsSignature(message: Record<string, string>): Promise<boolean> {
  if (!['1', '2'].includes(message.SignatureVersion) || !validAwsUrl(message.SigningCertURL, 'cert')) return false;
  const certificate = await fetch(message.SigningCertURL, { signal: AbortSignal.timeout(5000) }).then(response => {
    if (!response.ok) throw new Error('SNS certificate unavailable');
    return response.text();
  });
  return crypto.verify(
    message.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
    Buffer.from(signingText(message), 'utf8'),
    certificate,
    Buffer.from(message.Signature, 'base64'),
  );
}

router.post('/', async (req: Request, res: Response) => {
  try {
    if (!process.env.SES_SNS_TOPIC_ARN?.trim()) return res.status(503).json({ error: 'Email event topic is not configured.' });
    const message = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, string>;
    if (!message || !(await verifySnsSignature(message))) return res.status(403).json({ error: 'Invalid SNS signature.' });
    if (!matchesConfiguredTopic(message.TopicArn)) return res.status(403).json({ error: 'Unexpected SNS topic.' });
    if (message.Type === 'SubscriptionConfirmation') {
      if (!validAwsUrl(message.SubscribeURL, 'sns')) return res.status(400).json({ error: 'Invalid subscription URL.' });
      const response = await fetch(message.SubscribeURL, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('SNS subscription confirmation failed');
      return res.status(204).end();
    }
    if (message.Type !== 'Notification') return res.status(204).end();
    const event = JSON.parse(message.Message) as any;
    const eventType = String(event.eventType || event.notificationType || '').toLowerCase();
    const recipients: string[] = eventType === 'bounce'
      ? (event.bounce?.bouncedRecipients || []).map((item: any) => item.emailAddress)
      : eventType === 'complaint'
        ? (event.complaint?.complainedRecipients || []).map((item: any) => item.emailAddress)
        : [];
    if (eventType === 'bounce' || eventType === 'complaint') {
      await Promise.all(recipients.map(recipient => suppressRecipient(recipient, eventType, message.MessageId)));
    }
    return res.status(204).end();
  } catch (error) {
    console.error('[Email] SNS event failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(400).json({ error: 'Invalid email event.' });
  }
});

export default router;
