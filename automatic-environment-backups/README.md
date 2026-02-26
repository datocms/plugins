# Automatic environment backups

This plugin automatically creates daily and weekly backups of your primary DatoCMS environment.

It requires a serverless deployment of the companion function repository:
- https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function

## Setup

Setup is now fully in the plugin config screen (no installation modal).

1. Open the plugin config screen.
2. In **Lambda setup**, click **Deploy lambda** and choose one option:
   - Vercel: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Fdatocms-backups-scheduled-function&env=DATOCMS_FULLACCESS_API_TOKEN&project-name=datocms-backups-scheduled-function&repo-name=datocms-backups-scheduled-function
   - Netlify: https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function
   - Cloudflare: https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#deploying-on-cloudflare-workers
3. Deploy the companion function and copy its base URL.
4. Paste the URL into **Lambda URL**.
5. Click **Connect**.
6. Confirm status shows **Connected (ping successful)**.

The plugin validates connectivity by calling:
- `POST /api/datocms/plugin-health`

## Legacy deployments

If your deployment is older and does not expose `/api/datocms/plugin-health`, the plugin can fallback to the legacy initialization endpoint (`/.netlify/functions/initialization`) during Connect.

When this happens, a warning is shown in the config screen. Update/redeploy the companion function to remove the warning and use health-based validation.

## Notes

- Legacy plugin parameters (`netlifyURL`, `installationState`, `hasBeenPrompted`) are still supported for compatibility.
- Netlify Labs activation is no longer required.
