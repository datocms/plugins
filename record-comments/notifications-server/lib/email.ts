import Mailgun from 'mailgun.js';
import formData from 'form-data';

type EmailParams = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendEmailResult = 'sent' | 'disabled';

export async function sendEmail({ to, subject, text, html }: EmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !domain || !from) {
    console.log('Email disabled:', { to, subject, text });
    return 'disabled';
  }

  const mg = new Mailgun(formData).client({
    username: 'api',
    key: apiKey,
  });

  await mg.messages.create(domain, {
    from,
    to,
    subject,
    text,
    html,
  });

  return 'sent';
}
