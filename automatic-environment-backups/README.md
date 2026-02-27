# Automatic environment backups

This plugin creates daily and weekly backups of your DatoCMS primary environment.

The plugin supports two runtime modes:

1. `Lambda-full` (`Use Cronjobs` enabled)
2. `Lambda-less` (`Use Cronjobs` disabled)

The plugin requires the `currentUserAccessToken` permission.

## Runtime modes

Runtime is selected with a single toggle in the config screen:

- `Use Cronjobs` enabled: `Lambda-full` mode.
- `Use Cronjobs` disabled: `Lambda-less` mode.

Default behavior:

- Existing installs with a configured Lambda URL default to `Lambda-full`.
- New installs with no URL configured default to `Lambda-less`.

## Capability matrix

| Capability | Lambda-full (cron) | Lambda-less (on boot) |
|---|---|---|
| External scheduled execution (cron) | ✅ | ❌ |
| Works without deploying serverless function | ❌ | ✅ |
| Daily backup intent | ✅ | ✅ (best effort) |
| Weekly backup intent | ✅ | ✅ (best effort) |
| Exact execution time guarantees | ✅ (depends on scheduler) | ❌ |
| Manual “Run lambda test backup” from UI | ✅ | ❌ |

## Lambda-less trigger model (no built-in cron)

In Lambda-less mode, backups are request-driven:

- The plugin evaluates backup execution during `onBoot`.
- Daily backup runs once per UTC day, tracked by `automaticBackupsSchedule.dailyLastRunDate`.
- Weekly backup runs once per ISO week (UTC), tracked by `automaticBackupsSchedule.weeklyLastRunKey`.
- If the plugin is not booted for some time, due backups run the next time it boots.
- If one slot fails (daily/weekly), only successful slot watermarks are updated. Failed slots remain due for the next boot.

### Managed backup environments (rolling slots)

Lambda-less mode uses two managed environment IDs:

- `automatic-backups-daily`
- `automatic-backups-weekly`

Each run refreshes the corresponding slot by forking the current primary environment into that ID. Existing managed slots are replaced.

## Tradeoffs

### Lambda-full (cron)

Pros:

- Predictable scheduled timing.
- Independent from users opening DatoCMS/plugin UI.
- Keeps existing deployment flow and manual backup trigger UX.

Cons:

- Requires deploying and maintaining an external serverless function.
- Additional infrastructure cost/operational overhead.

### Lambda-less (on boot)

Pros:

- No external scheduler or Lambda deployment needed.
- Simpler operations and fewer moving pieces.

Cons:

- Best-effort cadence only; no exact run-time guarantees.
- Backups only execute when plugin boot is triggered.

## Setup

### Option 1: Lambda-less (default for new installs)

1. Open the plugin config screen.
2. Keep `Use Cronjobs` disabled.
3. Click `Save`.

Backups will run during plugin boot and maintain rolling daily/weekly slots.

### Option 2: Lambda-full (cron mode)

1. Open the plugin config screen.
2. Enable `Use Cronjobs`.
3. In **Lambda setup**, click **Deploy lambda** and choose one option:
   - Vercel: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Fdatocms-backups-scheduled-function&env=DATOCMS_FULLACCESS_API_TOKEN&project-name=datocms-backups-scheduled-function&repo-name=datocms-backups-scheduled-function
   - Netlify: https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function
   - Cloudflare: https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#deploying-on-cloudflare-workers
4. Paste the deployed URL into **Lambda URL**.
5. Click **Connect**.
6. Confirm status shows **Connected (ping successful)**.
7. Click **Save**.

## Lambda health handshake contract (Lambda-full mode)

The plugin validates connectivity by calling:

- `POST /api/datocms/plugin-health`

Legacy deployments that do not expose `/api/datocms/plugin-health` can still connect via legacy initialization fallback (`/.netlify/functions/initialization`), but should be upgraded.

## Migration and compatibility notes

- Legacy parameters (`netlifyURL`, `installationState`, `hasBeenPrompted`, `lambdaFullMode`) remain supported.
- `runtimeMode` is persisted and mirrors `lambdaFullMode` for compatibility.
- Switching to Lambda-less clears the connected Lambda URL and connection state on save.

## Failure behavior

- Lambda-full mode follows your external scheduler reliability model.
- Lambda-less mode records slot-level failure details in plugin parameters and retries failed due slots on next boot.
