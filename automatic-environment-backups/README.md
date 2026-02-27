# Automatic environment backups

This plugin creates automatic backups of your DatoCMS primary environment.

The plugin supports two runtime modes:

1. `Lambda-full` (`Use Cronjobs` enabled)
2. `Lambda-less` (`Use Cronjobs` disabled)

## Runtime modes

Runtime is selected with a single toggle in the config screen:

- `Use Cronjobs` enabled: `Lambda-full` mode.
- `Use Cronjobs` disabled: `Lambda-less` mode.

Default behavior:

- Existing installs with a configured Lambda URL default to `Lambda-full`.
- New installs with no URL configured default to `Lambda-less`.

Backup scheduling is cadence-only. Users can enable any combination of:

- Daily
- Weekly
- Bi-weekly
- Monthly

There is no configurable `HH:mm` run-time field.

## Capability matrix

| Capability | Lambda-full (cron) | Lambda-less (on boot) |
|---|---|---|
| External scheduled execution (cron) | ✅ | ❌ |
| Works without deploying serverless function | ❌ | ✅ |
| Daily/Weekly/Bi-weekly/Monthly cadence support | ✅ | ✅ (best effort) |
| Exact execution time guarantees | ✅ (depends on scheduler) | ❌ |
| Manual “Run lambda test backup” from UI | ✅ | ❌ |

## Lambda-less trigger model (no built-in cron)

In Lambda-less mode, backups are request-driven:

- The plugin evaluates backup execution during `onBoot`.
- Each cadence keeps its own watermark (for example in `automaticBackupsSchedule.lastRunLocalDateByCadence`).
- If the plugin is not booted for some time, due backups run the next time it boots.
- If one slot fails, only successful slot watermarks are updated. Failed slots remain due for the next boot.

### Concurrency safety (best effort lease lock)

Lambda-less `onBoot` now uses a lightweight lease lock in `automaticBackupsSchedule`:

- Lock fields: `executionLockRunId`, `executionLockOwnerUserId`, `executionLockAcquiredAt`, `executionLockExpiresAt`.
- Lock TTL is 20 minutes.
- After writing the lock, each runner waits 5.5 seconds before verifying lock ownership to account for parameter propagation.
- If a lock is already active, contenders skip immediately (no wait/retry loop).
- If lock write or verification is uncertain, execution fails closed (no backup run).
- Lock release happens only if the same run still owns the lock.

This reduces duplicate execution risk across near-simultaneous boots, but it is still best effort and not strict exactly-once coordination.

### Managed backup environments (rolling slots)

Lambda-less mode uses four managed environment IDs:

- `automatic-backups-daily`
- `automatic-backups-weekly`
- `automatic-backups-biweekly`
- `automatic-backups-monthly`

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
3. Choose one or more backup cadences.
4. Click `Save`.

Backups will run during plugin boot and maintain rolling cadence slots.

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
- `POST /api/datocms/scheduler-disconnect` when disconnecting Lambda or saving Lambda-less mode with a connected URL

Legacy deployments that do not expose `/api/datocms/plugin-health` can still connect via legacy initialization fallback (`/.netlify/functions/initialization`), but should be upgraded.
For scheduler disable, the plugin also falls back to `POST /.netlify/functions/scheduler-disconnect`.

## Migration and compatibility notes

- Legacy parameters (`netlifyURL`, `installationState`, `hasBeenPrompted`, `lambdaFullMode`) remain supported.
- `runtimeMode` is persisted and mirrors `lambdaFullMode` for compatibility.
- Switching to Lambda-less clears the connected Lambda URL and connection state on save.
- Disconnecting Lambda and switching to Lambda-less both attempt to disable the remote scheduler before clearing local Lambda connection fields.

## Failure behavior

- Lambda-full mode follows your external scheduler reliability model.
- Lambda-less mode records slot-level failure details in plugin parameters and retries failed due slots on next boot.
- If remote scheduler disable fails, the plugin still proceeds locally and shows a warning asking you to manually disable/delete the Lambda cron deployment to avoid duplicate backups.
