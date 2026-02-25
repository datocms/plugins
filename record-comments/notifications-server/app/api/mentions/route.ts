import { NextResponse } from 'next/server';
import { buildClient } from '@datocms/cma-client';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

type MentionNotificationPayload = {
  accessToken: string;
  mentionedUserId: string;
  mentionedUserEmail: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(req: Request) {
  const payload = (await req.json().catch(() => null)) as MentionNotificationPayload | null;
  if (!payload) return NextResponse.json({ error: 'bad_payload' }, { status: 400 });

  const { accessToken, mentionedUserId, mentionedUserEmail } = payload;

  if (!accessToken || !mentionedUserId || !mentionedUserEmail) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const client = buildClient({ apiToken: accessToken });

  try {
    const sender = await client.users.findMe().catch(() => null);
    const user = await client.users.find(mentionedUserId);

    if (!user.is_active) {
      return NextResponse.json({ error: 'user_inactive' }, { status: 403 });
    }

    const userEmail = normalizeEmail(user.email);
    const payloadEmail = normalizeEmail(mentionedUserEmail);

    if (!userEmail || userEmail !== payloadEmail) {
      return NextResponse.json({ error: 'email_mismatch' }, { status: 403 });
    }

    const senderFullName = sender && 'full_name' in sender ? sender.full_name : null;
    const senderEmail = sender && 'email' in sender ? sender.email : null;
    const senderName =
      senderFullName ||
      (senderEmail ? senderEmail.split('@')[0] : null) ||
      'Someone';

    await sendEmail({
      to: user.email,
      subject: `${senderName} mentioned you in a comment`,
      text: `${senderName} mentioned you in a comment in DatoCMS.`,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }
}
