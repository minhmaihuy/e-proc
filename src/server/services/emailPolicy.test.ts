import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { EMAIL_TEMPLATES, isEmailTemplate, renderEmail } from './emailPolicy.js';
import { isEmailProviderConfigured, isEmailRecipient, sqlTimestamp } from './emailDelivery.js';

test('all four required templates render text and escaped HTML without attachments', () => {
  assert.deepEqual(EMAIL_TEMPLATES, ['exam_invitation', 'exam_reminder', 'exam_result', 'identity_rejected']);
  for (const template of EMAIL_TEMPLATES) {
    const rendered = renderEmail(template, {
      studentName: '<script>alert(1)</script>',
      batchName: 'Assessment\r\nBcc: attacker@example.com',
      accessCode: 'ACCESS-123',
    });
    assert.ok(rendered.subject.length > 0);
    assert.doesNotMatch(rendered.subject, /[\r\n]/);
    assert.ok(rendered.text.length > 0);
    assert.doesNotMatch(rendered.html, /<script>/);
    assert.match(rendered.html, /&lt;script&gt;/);
    assert.deepEqual(Object.keys(rendered).sort(), ['html', 'subject', 'text']);
  }
  assert.equal(isEmailTemplate('unknown'), false);
});

test('SES configuration requires region, sender, SNS topic and configuration set', () => {
  assert.equal(isEmailRecipient('candidate@example.com'), true);
  assert.equal(isEmailRecipient('not-an-email'), false);
  assert.equal(isEmailProviderConfigured({ AWS_REGION: 'ap-southeast-1', SES_FROM_EMAIL: 'mail@example.com' }), false);
  assert.equal(isEmailProviderConfigured({
    AWS_REGION: 'ap-southeast-1', SES_FROM_EMAIL: 'not-an-email', SES_SNS_TOPIC_ARN: 'not-an-arn',
  }), false);
  assert.equal(isEmailProviderConfigured({
    AWS_REGION: 'ap-southeast-1',
    SES_FROM_EMAIL: 'mail@example.com',
    SES_SNS_TOPIC_ARN: 'arn:aws:sns:ap-southeast-1:123456789012:events',
    SES_CONFIGURATION_SET: 'eproc-events',
  }), true);
  assert.equal(isEmailProviderConfigured({
    AWS_REGION: 'ap-southeast-1',
    SES_FROM_EMAIL: 'mail@example.com',
    SES_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:events',
    SES_CONFIGURATION_SET: 'eproc-events',
  }), false, 'the feedback topic must be in the SES region');
});

test('email queue timestamps compare correctly with SQLite CURRENT_TIMESTAMP', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`CREATE TABLE email_queue (
      status TEXT NOT NULL,
      sent_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    database.exec("INSERT INTO email_queue (status, sent_at) VALUES ('sent', CURRENT_TIMESTAMP)");
    database.exec("INSERT INTO email_queue (status) VALUES ('sending')");
    const dayStart = sqlTimestamp(new Date(new Date().setUTCHours(0, 0, 0, 0)));
    const sentToday = database.prepare(`SELECT COUNT(*) AS count FROM email_queue
      WHERE (status = 'sent' AND sent_at >= ?) OR (status = 'sending' AND updated_at >= ?)`)
      .get(dayStart, dayStart) as { count: number };
    assert.equal(sentToday.count, 2, 'fresh sent and sending rows must consume the daily safety limit');

    const stale = database.prepare("SELECT COUNT(*) AS count FROM email_queue WHERE status = 'sending' AND updated_at < ?")
      .get(sqlTimestamp(new Date(Date.now() - 10 * 60_000))) as { count: number };
    assert.equal(stale.count, 0, 'a fresh sending lease must not be reclaimed immediately');
    assert.match(sqlTimestamp(new Date()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  } finally {
    database.close();
  }
});
