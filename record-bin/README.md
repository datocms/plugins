# 🗑 Record Bin

Record Bin is a DatoCMS plugin that stores deleted records so they can be restored later.

The plugin requires an auxiliary lambda deployment. Setup is done entirely in the plugin config screen.
The plugin also requires the `currentUserAccessToken` permission to manage project webhooks.

## Setup (config-screen first)

1. Open the plugin config screen.
2. Click `Deploy lambda` and choose one option:
   - Vercel
   - Netlify
   - Cloudflare
3. Paste your deployed URL into `Lambda URL`.
   - You can paste either `https://your-app.netlify.app` or just `your-app.netlify.app`; the plugin will prepend `https://` when needed.
4. Click `Connect lambda`.
5. Confirm status shows `Connected (ping successful)`.
6. The plugin creates or updates a project webhook named `🗑️ Record Bin` pointing to your lambda root URL.

From that point on, deleted records appear in the `🗑 Record Bin` model and can be restored with `Restore record ♻️`.

If you click `Disconnect current lambda function`, the plugin removes the `🗑️ Record Bin` webhook and clears the saved lambda URL.

If restoration fails, an error modal can show the full API payload.

On the config screen you can also enable the `debug` switch to log boot, cleanup, health checks, and restoration events in the browser console.

## Lambda health handshake contract

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
- `config_connect` when the user clicks `Connect lambda` on the config screen.
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

## Record Bin webhook contract

On connect, the plugin reconciles a managed project-level webhook (creates if missing, updates if existing):

- `name`: `🗑️ Record Bin` (legacy `🗑 Record Bin` is migrated)
- `url`: the connected lambda base URL (for example, `https://record-bin.example.com`)
- `events`: `item.delete`
- `custom_payload`: `null`
- `headers`: `{}`
- `http_basic_user`: `null`
- `http_basic_password`: `null`
- `enabled`: `true`
- `payload_api_version`: `3`
- `nested_items_in_payload`: `true`
