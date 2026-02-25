# Record Comments Notifications

Serverless Next.js endpoint for sending mention notifications.

## Setup
1. Copy `.env.example` to `.env.local` and fill in secrets.
2. Install dependencies: `npm install`
3. Run locally: `npm run dev`

## Vercel (CLI)
From the repo root:
1. `cd notifications-server`
2. `npx vercel login`
3. `npx vercel link`
4. `npx vercel env add MAIL_FROM production` (paste value when prompted)
5. `npx vercel env add MAILGUN_API_KEY production` (paste value when prompted)
6. `npx vercel env add MAILGUN_DOMAIN production` (paste value when prompted)
7. `npx vercel --prod`

## Required env
- `MAIL_FROM`: sender address for notifications
- `MAILGUN_API_KEY`: Mailgun API key
- `MAILGUN_DOMAIN`: Mailgun sending domain

## Mail service
Uses Mailgun via `mailgun.js`.

## Endpoint
`POST /api/mentions`

Expects payloads sent directly from the plugin when a mention is created.

Payload shape:
```json
{
  "accessToken": "ctx.currentUserAccessToken",
  "mentionedUserId": "user-id",
  "mentionedUserEmail": "user@example.com"
}
```
