export const EMAIL_TEMPLATES = ['exam_invitation', 'exam_reminder', 'exam_result', 'identity_rejected'] as const;
export type EmailTemplate = typeof EMAIL_TEMPLATES[number];

export interface EmailPayload {
  studentName?: string;
  batchName?: string;
  accessCode?: string;
  examStart?: string;
}

export function isEmailTemplate(value: unknown): value is EmailTemplate {
  return typeof value === 'string' && EMAIL_TEMPLATES.includes(value as EmailTemplate);
}

export function renderEmail(template: EmailTemplate, payload: EmailPayload): { subject: string; text: string; html: string } {
  const safeLine = (value: unknown, fallback: string, limit: number) => String(value || fallback).replace(/[\r\n]+/g, ' ').slice(0, limit);
  const student = safeLine(payload.studentName, 'Candidate', 160);
  const batch = safeLine(payload.batchName, 'your assessment', 160);
  const accessCode = safeLine(payload.accessCode, '', 80);
  const start = safeLine(payload.examStart, '', 120);
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  const messages: Record<EmailTemplate, { subject: string; body: string }> = {
    exam_invitation: { subject: `Invitation: ${batch}`, body: `Hello ${student},\nYou are invited to ${batch}.\nAccess code: ${accessCode}\nStart: ${start}` },
    exam_reminder: { subject: `Reminder: ${batch}`, body: `Hello ${student},\nThis is a reminder for ${batch}.\nAccess code: ${accessCode}\nStart: ${start}` },
    exam_result: { subject: `Result: ${batch}`, body: `Hello ${student},\nYour result is available in the assessment portal.` },
    identity_rejected: { subject: `Identity verification requires attention: ${batch}`, body: `Hello ${student},\nThe submitted identity photo could not be approved. Please contact your assessment administrator.` },
  };
  const rendered = messages[template];
  return { subject: rendered.subject, text: rendered.body, html: `<p>${escape(rendered.body).replace(/\n/g, '<br>')}</p>` };
}
