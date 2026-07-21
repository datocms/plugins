# Automatic Environment Backups

This plugin creates automatic, rotating backups of your DatoCMS primary environment by cloning them into sandbox environments within the same project.

Because DatoCMS does not have a built-in job scheduler, the plugin has to create an external scheduled lambda (serverless function) to invoke the backup functionality on a recurring basis. It currently supports deployments to Vercel, Cloudflare, and Netlify.

The lambda function is only used as a job scheduler, similar to a cronjob. The lambda calls the DatoCMS Content Management API (CMA) to actually manage the environments and perform the backups.

## How it works

- The plugin's configuration screen is a guided, four-step wizard with a progress bar showing the state of each step.
- Backup cadence is configured in the plugin (`daily`, `weekly`, `bi-weekly`, `monthly`).
- The deployed scheduler runs once a day (02:05 UTC) and calls the backup endpoints.
- The plugin validates connectivity to the serverless function with a health check against `/api/datocms/plugin-health`, authenticated with a shared secret.
- **Backup status** lists each enabled schedule with its last run, next scheduled run, and linked sandbox environment, plus a per-schedule **Backup now** button for on-demand execution.
- The created backups are just forked sandboxes inside your DatoCMS project (named with a `backup-plugin-<cadence>` prefix), NOT separate files on an external provider. The external providers are only used to run the scheduled function that calls the CMA to create a backup.
- Source code for the deployed lambda function is at https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function (this lambda was written by Marcelo Finamor, a DatoCMS employee).

## Before you begin

- You will need an account with Vercel, Netlify, or Cloudflare that is capable of creating projects and adding serverless functions (lambdas). Usually the free plan will suffice.
- In your DatoCMS project, you will have to create a new API token with access to the CMA and an admin role. In older DatoCMS projects, this may have been automatically created as a "Full Access API Token", but newer projects will require manual creation of a similar token.

## Setup

After reading the "Before you begin" section, install the plugin and open your DatoCMS project Configuration → Plugins → Automatic Environment Backups.

The configuration screen then walks you through four focused steps. Only the step you need to work on opens automatically. Completed steps collapse to a short summary and future steps stay collapsed; click any completed step to review it. The progress bar reads **Setup complete** once everything is configured.

1. **Step 1 — Create a secret.** A strong shared secret is generated for you. Click **Save & copy secret** to store it and copy it to your clipboard. Use **Generate new** before saving if you want a different value.
2. **Step 2 — Deploy the backup service.** Open or create a full-access DatoCMS API token, then choose Vercel, Netlify, or Cloudflare. Configure both required environment variables on the provider: set `DATOCMS_FULLACCESS_API_TOKEN` to the API token and `DATOCMS_BACKUPS_SHARED_SECRET` to the secret copied in Step 1. Deploy the service, copy its public URL (for example, `https://my-backups.netlify.app`), paste it into the plugin, and click **Save deployment URL**.
3. **Step 3 — Test the connection.** Run the connection test against the saved deployment URL. The status box confirms that the service responds and authenticates, or shows the exact error. For example, an authentication error means the plugin secret and the provider's `DATOCMS_BACKUPS_SHARED_SECRET` value do not match.
4. **Step 4 — Backup schedule.** Choose the cadences you want and save the schedule. The plugin creates any missing backup environments for the enabled cadences.

Once all four steps are complete, **Backup status** shows the last and next backup, the linked environment for each schedule, and a **Backup now** button. You can leave the screen — backups run on their own.

## Managing the connection

- Click any completed step to change the secret, deployment URL, or schedule. Automatic progression still opens only the current step.
- Changing the shared secret clears the verified connection so Step 3 must be tested again. Update `DATOCMS_BACKUPS_SHARED_SECRET` on the deployed service and redeploy before testing.
- Use **Remove saved deployment** in Step 2 to clear the URL and return the flow to that step. The external provider keeps running until you remove the deployment there, but the plugin will no longer surface its status.
- Re-opening the configuration screen automatically re-runs a health check against the saved URL, so a broken or expired deployment is caught immediately in Step 3 and in **Backup status**.

## Advanced settings

- **Enable debug logs** — When enabled, plugin events and outbound requests are logged to the browser console for troubleshooting.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
