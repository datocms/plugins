import { logError } from '@/utils/errorLogger';
import type { UserInfo } from '@utils/userTransformers';

type MentionNotificationPayload = {
  accessToken: string;
  mentionedUserId: string;
  mentionedUserEmail: string;
};

type SendMentionNotificationsParams = {
  endpoint?: string;
  accessToken?: string | null;
  mentionedUserIds: string[];
  users: UserInfo[];
  currentUserId: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function sendMentionNotifications({
  endpoint,
  accessToken,
  mentionedUserIds,
  users,
  currentUserId,
}: SendMentionNotificationsParams): Promise<void> {
  if (!endpoint || !accessToken) return;
  if (mentionedUserIds.length === 0) return;

  const userById = new Map(users.map((user) => [user.id, user]));

  const payloads: MentionNotificationPayload[] = [];

  for (const mentionedUserId of mentionedUserIds) {
    if (!mentionedUserId || mentionedUserId === currentUserId) continue;
    const user = userById.get(mentionedUserId);
    if (!user?.email) continue;

    payloads.push({
      accessToken,
      mentionedUserId,
      mentionedUserEmail: normalizeEmail(user.email),
    });
  }

  if (payloads.length === 0) return;

  const results = await Promise.allSettled(
    payloads.map((payload) =>
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`Notification request failed (${response.status})`);
        }
      })
    )
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    logError('Failed to send mention notifications', undefined, {
      failures: failures.length,
      endpoint,
    });
  }
}
