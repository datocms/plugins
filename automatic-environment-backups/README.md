# Automatic Environment Backups

This plugin creates automatic, rotating backups of your DatoCMS primary environment by cloning them into sandbox environments within the same project.

Because DatoCMS does not have a built-in job scheduler, the plugin has to create an external scheduled lambda (serverless function) to invoke the backup functionality on a recurring basis. It currently supports deployments to Vercel, Cloudflare, and Netlify.

The lambda function is only used as a job scheduler, similar to a cronjob. The lambda calls the DatoCMS Content Management API (CMA) to actually manage the environments and perform the backups.

## How it works

- Backup cadence is configured in the plugin (`daily`, `weekly`, `bi-weekly`, `monthly`).
- The deployed scheduler calls the backup endpoints.
- The plugin validates connectivity between the serverless functions using health checks against `/api/datocms/plugin-health`.
- The **Backup overview** lists each enabled cadence with its last run, next scheduled run, and the linked sandbox environment, plus a per-slot **Backup now** button for on-demand execution.
- The created backups are just forked sandboxes inside your DatoCMS project (named with a `backup-plugin-<cadence>` prefix), NOT separate files on an external provider. The external providers are only used to provide scheduled lambda executions that call our API to create a scheduled backup.
- Source code for the deployed lambda function is at https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#deploying-on-cloudflare-workers (this lambda was written by Marcelo Finamor, a DatoCMS employee).

## Before you begin
- You will need an account with Vercel, Netlify, or Cloudflare that is capable of creating projects and adding serverless functions (lambdas). Usually the free plan will suffice.
- In your DatoCMS project, you will have to create a new API token with access to the CMA and an admin role. In older DatoCMS projects, this may have been automatically created as a "Full Access API Token", but newer projects will require manual creation of a similar token.

## Setup

1. Make sure you've read the "Before you begin" section, above.
2. Install the plugin.
3. Open your DatoCMS project Configuration and find the Automatic Environment Backups plugin settings.
4. In the **Lambda setup** section, leave the Lambda URL blank for now (it will be used later).
5. Change the default `superSecretToken` lambda auth secret to something safer, preferably a pseudorandom string.
6. Click the **Deploy lambda** button and choose one of the provided options (Vercel, Netlify, or Cloudflare).
7. A new browser tab will open where you must finish the lambda setup on that provider. You'll have to provide the project CMA API token (`DATOCMS_FULLACCESS_API_TOKEN`) and the lambda auth secret (`DATOCMS_BACKUPS_SHARED_SECRET`) that you configured earlier.
8. Once the lambda is deployed on the external provider, find and copy its deployment domain, e.g. `https://my-backup-app.vercel.app/` (just the domain, no path needed). Make sure it is publicly accessible and not hidden behind a preview login gate.
9. Back in the plugin settings, paste that deployed URL into the **Lambda URL** field.
10. Click **Connect**, wait a few seconds, and confirm that the health check status is **Connected (ping successful)**.
11. Toggle on the backup cadences you want under **Backup schedule** and click **Save**. After saving, the plugin automatically creates any missing backup environments for the enabled cadences.

## Managing the connection

- Use **Change Lambda URL** to point at a different deployment; the plugin re-runs the health ping against the new URL before persisting it.
- Use **Disconnect** to clear the saved Lambda URL. The cron schedule on the external provider keeps running until you remove the deployment there, but the plugin will no longer surface its status.
- Re-opening the configuration screen runs a health check against the saved URL automatically, so a stale or expired deployment is caught before you make any other changes.

## Advanced settings

- **Enable debug logs** — When enabled, plugin events and outbound lambda requests are logged to the browser console for troubleshooting.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
