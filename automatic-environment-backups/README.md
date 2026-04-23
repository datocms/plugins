# Automatic Environment Backups

![Automatic environment backups](https://raw.githubusercontent.com/datocms/plugins/master/automatic-environment-backups/docs/demo.jpeg)

This plugin creates automatic, rotating backups of your DatoCMS primary environment by cloning them into sandbox environments within the same project.

Because DatoCMS does not have a built-in job scheduler, the plugin has to create an external scheduled lambda (serverless) function to invoke the backup functionality on a recurring basis. It currently supports serverless functions from Vercel, Cloudflare, and Netlify.

The lambda serverless function is only used as a job scheduler, calling our API to manage the environments. 

## How it works

- Backup cadence is configured in the plugin (`daily`, `weekly`, `bi-weekly`, `monthly`).
- The deployed scheduler calls the backup endpoints on your Lambda deployment.
- The plugin validates Lambda connectivity using health checks.
- The backup overview includes a per-slot **Backup now** action for on-demand execution.
- The created backups are just forked sandboxes inside your DatoCMS project, NOT separate files on an external provider. The external providers are only used to provide scheduled lambda executions that call our API to create a scheduled backup.
- Source code for the deployed lambda function is at https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#deploying-on-cloudflare-workers (this was written by Marcelo Finamor, a DatoCMS employee)

## Before you begin
- You will need an account with Vercel, Netlify, or Cloudflare that is capable of creating projects and adding serverless functions (lambdas). Usually the free plan will suffice.
- In your DatoCMS project, you will have to create a new API token with access to the CMA and an admin role. In older DatoCMS projects, this may have been automatically created as a "Full Access API Token", but newer projects will require manual creation of a similar token.

## Setup

1. Make sure you're read the "Before you begin" section, above.
2. Install the plugin.
3. Open your DatoCMS project Configuration and find the Automatic Environment Backup plugin settings.
4. In the **Lambda setup** section, leave the Lambda URL blank for now (it will be used later).
5. Change the default `superSecretToken` lambda auth secret to something safer, preferably an pseudorandom string.
6. Click the **Deploy lambda** button and choose one of the provided options (Vercel, Netlify, or Cloudflare).
7. A new browser tab will open where you must finish the lambda setup on that provider. You'll have to provide the project CMA API token and the lambda auth secret that you configured earlier.
8. Once the lambda is deployed on the external provider, find and copy its deployment domain, e.g. https://my-backup-app.vercel.app/ (just the domain, no path needed). Make sure it is publicly accessible and not hidden behind a preview login gate.
9. Back in the plugin settings, aste that deployed URL into the **Lambda URL** field
10. Click **Connect**, wait a few seconds, and confirm that the health check status is **Connected (ping successful)**.
11. Configure your backup schedules and click **Save**.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
