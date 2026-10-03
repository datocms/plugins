# 🗑 Record Bin

![example.png](public/example.png)

Record Bin stores a copy of deleted records in its own "Record Bin" model. In Lambda-less mode, dashboard deletion is allowed only after the archive is saved and verified. These copies can be restored individually to their original models later in case of an accidental deletion.

It works similarly to the trash can / recycling bin on your computer filesystem.

See "Important limitations and behavior" below for API deletions, concurrent changes, storage limits, and large selections.

## Usage

When you install the plugin, it is automatically configured and should catch deletion events in your models.

To test it, create a draft record in any model, enter some fake content, and then save it. Then delete that same record.

Within a few seconds, you should see a new "Record Bin" model appear in the left sidebar, and a deleted copy of that record should appear within it.

Note that the deleted record will not look the same as it originally did, because the plugin stores it as a machine-readable JSON copy. But once you restore it to the original model, it should look the same again.

### How the basic mode works

The plugin uses [Event Hooks](https://www.datocms.com/docs/plugin-sdk/event-hooks) from the DatoCMS Plugins SDK to intercept record deletion events (specifically, `onBeforeItemsDestroy`). Right before the record is deleted, it makes a JSON copy and saves it to its own Record Bin model.

Upon restore, it uses that saved JSON to re-create the record in the original model.

## (Optional) Advanced usage: Also save records deleted from the API

Normally, per above, the plugin will catch record deletions done from within the CMS itself. That is where the plugin runs and the lifecycle event hooks occur. This should be fine for most projects.

However, the normal mode will NOT catch record deletions done via the Content Management API, outside of the CMS.

If you have developers, scripts, or integrations that may accidentally delete records via the API, you may wish to consider enabling this advanced mode in order to catch those deletions as well.

This mode takes a bit more setup, but is safer if you ever manipulate your project via API.

### How advanced (lambda) mode works

This advanced "lambda" mode will auto-configure some "on record delete" webhooks, coupled to external serverless functions on Vercel/Netlify/Cloudflare, in order to also catch these programmatic deletions from the API.

A lambda, also known as a serverless function, is just a simple script that can execute some API calls in response to our "on record delete" webhook. We need to host it on an external provider because DatoCMS doesn't host user-generated lambdas.

### Setup for the advanced mode (only)

(Again: You do not need this UNLESS you use the Content Management API to delete records, and also wish to protect against accidental deletions there.)

1. First, make sure you have an CMA API token with admin permissions. On older DatoCMS projects this was automatically created as a "Full Access Token", but you'll have to manually make one in newer projects.
2. Open the plugin config screen.
3. Expand the "Advanced settings" accordion.
4. Enable the `Also save records deleted from the API` toggle.
5. A Lambda setup section will then appear above the Advanced settings.
6. Click `Deploy lambda` and choose one option (Vercel, Netlify, or Cloudflare). This will clone our [lambda webhook functions](https://github.com/marcelofinamorvieira/record-bin-lambda-function) (written by DatoCMS employee Marcelo Finamor) into the provider of your choice.
7. Follow the setup instructions in that provider, including providing your CMA API token when requested.
8. Once deployment is complete, find the deployed URL and and copy it to your clipboard.
9. Go back to the plugin settings and paste that URL into the `Lambda URL` field.
10. Click `Connect` to test the configuration.
11. Confirm status shows `Connected (ping successful)`.

When connected, the plugin creates or updates a project webhook named `🗑️ Record Bin` pointing to your lambda function.
The current user role must be allowed to manage webhooks for connect/disconnect operations.

## Important limitations and behavior

- In Lambda-less mode, API-triggered deletions are not captured. Only dashboard-triggered deletions go to the bin.
- Lambda-less capture blocks deletion if any selected record cannot be archived and verified. Successfully saved archives remain available after an interrupted or rejected operation; repeated capture reconciles a stable archive ID instead of creating another copy.
- Reads use bounded batches of 20 records with complete nested blocks, and up to four archive writes run concurrently. Requests are paced and transient reads are retried automatically. Capture runs continuously, without mandatory pause/resume checkpoints.
- Captured versions are rechecked before allowing deletion. This detects edits during capture, but the CMA does not provide an atomic snapshot or conditional bulk deletion: a concurrent write after the final check remains possible.
- Large JSON bodies are compressed with gzip/base64 inside the private `record_body` field. The full escaped request must fit 280,000 bytes, leaving room below the CMA's 300 KB record limit. Bodies that still do not fit are rejected before deletion. No public upload is created.
- A full pre-deletion archive requires project quota for every archive record alongside the originals. Assets are referenced, not copied; restoration still depends on the original assets, referenced records, and compatible models.
- The CMA accepts at most 200 IDs per bulk deletion. The inspected dashboard submits one bulk request for the entire selection. Until the dashboard implements batching after collecting every plugin's veto, this plugin blocks larger selections. Running bulk deletion inside one hook would bypass concurrent vetoes from other plugins, so the plugin never takes over the host's deletion.
- Lambda mode still uses the separately deployed deletion webhook for ordinary selections. That webhook runs after deletion; its performance, retries, and capture integrity require a separate audit of the deployed backend. This plugin does not guarantee pre-deletion capture for API deletions or that backend.
- Existing webhook-origin `record_body` payloads are still restorable.
- Uncompressed Lambda-less payloads retain the webhook-compatible envelope (`event_type: to_be_restored`). New locally captured and compressed archives are restored locally even after switching runtime modes; legacy webhook archives retain the Lambda flow.
- Individual restoration preserves the original UUID where supported, validates complete restored content before removing the archive, and leaves the archive intact on conflicts or integrity failures. Only timestamps present in the archive are checked; server-generated timestamps on legacy archives do not count as content changes. Historical numeric IDs receive a deterministic new UUID. Incoming links removed from other records during deletion are not reconstructed by restoring the archived record.

### Local validation

Run `npm ci`, then `npm run check` from this plugin directory. `check` aggregates TypeScript, deterministic mocked tests, and the production build. The monorepo `run-checks.js` targets other plugins and does not include Record Bin.

The tests include a virtual 200,000-ID worker queue, bounded nested capture batches, many locales/models, opaque JSON, corruption, cancellation, and uncertain writes. Synthetic fixtures do not establish production throughput, memory usage, multi-hour iframe survival, or compatibility with a live dashboard. Some fixtures deliberately exceed the CMA's per-record block/locale limits to exercise local traversal only.

## For developers only: Additional technical details

### Lambda health handshake contract (Lambda runtime)

The plugin sends this request payload to `POST /api/datocms/plugin-health`:

```json
{
  "event_type": "plugin_health_ping",
  "mpi": {
    "message": "DATOCMS_RECORD_BIN_PLUGIN_PING",
    "version": "2026-02-25",
    "phase": "config_connect"
  },
  "plugin": {
    "name": "datocms-plugin-record-bin",
    "environment": "main"
  }
}
```

`phase` values:

- `config_connect` when the user clicks `Connect` on the config screen.
- `config_mount` every time the config screen is opened.
- `finish_installation` is legacy and kept for backward compatibility with older saved states.

Expected successful response (`HTTP 200`):

```json
{
  "ok": true,
  "mpi": {
    "message": "DATOCMS_RECORD_BIN_LAMBDA_PONG",
    "version": "2026-02-25"
  },
  "service": "record-bin-lambda-function",
  "status": "ready"
}
```

Any non-200 status, invalid JSON, timeout, network failure, or contract mismatch is treated as a connectivity error.

### Record Bin webhook contract (Lambda runtime)

On connect, the plugin reconciles a managed project-level webhook (creates if missing, updates if existing):

- `name`: `🗑️ Record Bin` (legacy `🗑 Record Bin` is migrated)
- `url`: connected lambda base URL
- `events`: `item.delete`
- `custom_payload`: `null`
- `headers`: `{}`
- `http_basic_user`: `null`
- `http_basic_password`: `null`
- `enabled`: `true`
- `payload_api_version`: `3`
- `nested_items_in_payload`: `true`

## Release history

See [CHANGELOG.md](CHANGELOG.md).
