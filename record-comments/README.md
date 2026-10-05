# Record Comments

Adds a **Comments** panel to the record sidebar so editors can discuss a record right where they're editing it. Comments can be replied to, upvoted, edited and deleted, and can mention users, fields, records, assets and models.

## Setup

Install the plugin from **Configuration → Plugins**. The first time it runs, it creates a model called `project_comment` to store all comments, so the user who first opens it needs permission to manage models and fields. After that, editors need to be able to create and update records in that model.

Realtime updates are optional but recommended if more than one person comments on the same record. In the plugin settings, turn on **Enable Real-Time Updates**, paste a read-only Content Delivery API token (from your project's API tokens settings) and save. Without a token the plugin still works, but other people's comments only show up when you reload the record.

## Usage

Open a saved record and expand the **Comments** panel. Press **Enter** to send and **Shift + Enter** for a new line. New records need to be saved once before they can be commented on.

To mention something, type `/` or use the toolbar buttons:

- `/user` mentions a project user or SSO user
- `/field` references a field of the record, including fields inside blocks, and scrolls to it when clicked
- `/record` links to another record (pick the model first)
- `/asset` links to an asset from the media library
- `/model` references a model, for users with schema access

## Migrating from older versions

Older versions stored comments in a `comment_log` field on each model. To move them to `project_comment`, open the plugin settings, expand **Advanced settings** and click **Scan for Legacy Comments**. Review the models it finds, start the migration, and once you've checked the result you can delete the old `comment_log` fields from the same screen.

Run it as the project owner or a user who can read every record in those models, since role restrictions can hide comments and block the migration. Keep the screen open until it finishes, and avoid editing comments or creating and deleting records in those models until cleanup is done. A record whose discussion exceeds the [300 KB record limit](https://www.datocms.com/docs/content-management-api/technical-limits) can't be migrated, and its old field is left in place.

## Troubleshooting

If the plugin can't verify comment storage, the user who loaded it probably can't manage models and fields. Ask a project admin to reload the plugin once so the setup can run.

If comments fail to save, check that the current role can create and update records in `project_comment`.

## Development

```bash
npm install
npm run dev
npm run test:unit
npm run build
```

Report issues at [github.com/datocms/plugins](https://github.com/datocms/plugins/issues).
