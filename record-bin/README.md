# 🗑 Record Bin

Record Bin stores deleted records so they can be restored later.

The plugin now supports two runtimes:

1. `Lambda` runtime (webhook/API capable)
2. `Lambda-less` runtime (dashboard delete capture only)

## Runtime modes

Runtime is selected with a single toggle in the plugin config screen:

- Toggle off (`Also save records deleted from the API` disabled): `Lambda-less` mode.
- Toggle on (`Also save records deleted from the API` enabled): `Lambda-full` mode.

If you are not sure what Lambda is, keep the toggle off.

If no explicit runtime has ever been saved yet, the plugin falls back to legacy auto-detection:

- Lambda URL present -> `Lambda-full`
- No Lambda URL -> `Lambda-less`

## Capability matrix

| Capability | Lambda runtime | Lambda-less runtime |
|---|---|---|
| Capture dashboard deletions | ✅ | ✅ |
| Capture API deletions | ✅ | ❌ |
| Restore from Record Bin | ✅ | ✅ |

## Setup

### Option 1: Lambda-less (default)

1. Open the plugin config screen.
2. Keep `Also save records deleted from the API` disabled.
3. Save plugin settings.

In this mode, deleted records are captured through `onBeforeItemsDestroy`.

### Option 2: Lambda-full (API deletion capture)

1. Open the plugin config screen.
2. Enable `Also save records deleted from the API`.
3. Lambda setup fields appear. Click `Deploy lambda` and choose one option:
   - Vercel
   - Netlify
   - Cloudflare
4. Paste your deployed URL into `Lambda URL`.
   - You can paste either `https://your-app.netlify.app` or just `your-app.netlify.app`; the plugin will prepend `https://` when needed.
5. Click `Connect`.
6. Confirm status shows `Connected (ping successful)`.

When connected, the plugin creates or updates a project webhook named `🗑️ Record Bin` pointing to your lambda root URL.
The current user role must be allowed to manage webhooks for connect/disconnect operations.

## Important limitations and behavior

- In Lambda-less mode, API-triggered deletions are not captured. Only dashboard-triggered deletions go to the bin.
- Lambda-less capture is fail-open: if backup capture fails, deletion still proceeds.
- Existing webhook-origin `record_body` payloads are still restorable.
- New Lambda-less payloads are stored in a webhook-compatible envelope (`event_type: to_be_restored`) so records stay restorable after runtime switches.

## Lambda health handshake contract (Lambda runtime)

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

## Record Bin webhook contract (Lambda runtime)

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
