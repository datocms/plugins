# Automatic environment backups

This plugin manages automatic backups of your DatoCMS primary environment using an external Lambda deployment with cron scheduling.

## How it works

- Backup cadence is configured in the plugin (`daily`, `weekly`, `bi-weekly`, `monthly`).
- The deployed scheduler calls the backup endpoints on your Lambda deployment.
- The plugin validates Lambda connectivity using health checks.

## Setup

1. Open the plugin config screen.
2. In **Lambda setup**, click **Deploy lambda** and choose one option:
   - Vercel: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Fdatocms-backups-scheduled-function&env=DATOCMS_FULLACCESS_API_TOKEN,DATOCMS_BACKUPS_SHARED_SECRET&project-name=datocms-backups-scheduled-function&repo-name=datocms-backups-scheduled-function
   - Netlify: https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function
   - Cloudflare: https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#deploying-on-cloudflare-workers
3. Configure `DATOCMS_BACKUPS_SHARED_SECRET` in the Lambda deployment environment (`superSecretToken` is the default).
4. Paste the deployed URL into **Lambda URL**.
5. Paste the same secret into **Lambda auth secret** (defaults to `superSecretToken` in the plugin UI).
6. Click **Connect** and confirm status is **Connected (ping successful)**.
7. Choose backup cadences and click **Save**.

## Lambda API contract

The plugin uses these Lambda endpoints:

- `POST /api/datocms/plugin-health`
- `POST /api/datocms/backup-status`

All requests include `X-Datocms-Backups-Auth` and must match `DATOCMS_BACKUPS_SHARED_SECRET`.
