# Record Comments

Record Comments adds a **Comments** sidebar panel to DatoCMS records, so editors can discuss work without leaving the record they are editing.

Comments support replies, upvotes, editing, deletion, and rich mentions for users, fields, records, assets, and models.

## Features

- Threaded comments on saved records
- Replies, upvotes, editing, and deletion
- Realtime updates when a Content Delivery API token is configured
- Standard mode that works without a delivery token
- Mentions for users, fields, records, assets, and models

## Installation

1. In your DatoCMS project, open **Settings → Plugins**.
2. Search for **Record Comments**.
3. Install the plugin.
4. Open the plugin settings and choose whether to use realtime updates.

## First-time setup and permissions

The first time the plugin runs, it creates or verifies an internal model called `project_comment`. This model stores comments in three fields:

- `model_id`
- `record_id`
- `content`

The user who performs the first setup must be able to manage models and fields. After setup, editors can use the sidebar from any saved record.

## Realtime updates vs. standard mode

Realtime updates are recommended when more than one person may comment on the same record.

To enable them:

1. Open **Settings → API Tokens**.
2. Copy a read-only Content Delivery API token.
3. Open **Settings → Plugins → Record Comments**.
4. Enable realtime updates, paste the token, and save.

With realtime updates enabled, new comments, replies, edits, deletes, and upvotes appear for other editors as they happen.

Without realtime updates, the plugin still works. It loads comments through the project API when the sidebar opens and saves your own changes immediately, but comments from other editors will not appear instantly. Reload the record or sidebar to see updates made elsewhere.

## Using comments

Open a saved record and expand the **Comments** sidebar panel.

- Write a comment and press **Enter** to send it.
- Press **Shift + Enter** for a new line.
- Reply to an existing thread from the comment actions.
- Edit or delete your own comments when the action is shown.
- Upvote a comment to mark it as useful.
- Use the toolbar buttons or type `/` to insert mentions.

New, unsaved records cannot receive comments yet because the plugin needs the record ID.

## Mentions

Type `/` in the composer to open the command menu, or type a command directly:

| Command | What it inserts | Notes |
| --- | --- | --- |
| `/user` | A project user mention | Searches regular users and SSO users. User mentions link to the relevant user settings page when possible. |
| `/field` | A field reference | Supports top-level fields, localized fields, and fields inside modular content, single block, and Structured Text blocks. Clicking the mention tries to scroll to that field in the record. |
| `/record` | A record link | First choose a model, then choose a record. Clicking the mention opens the referenced record. |
| `/asset` | An asset link | Opens the upload picker. Requires upload read permission. Images and videos show a small preview when one is available. |
| `/model` | A model reference | Available to users with schema access. Clicking the mention opens the model or block model in the schema area. |

You can use the same mention tools in replies. Existing mention chips are clickable when the current user has the right access and the target still exists.

## Migrating older comments

Older versions of this plugin stored comments in a `comment_log` field on each model. The current version uses the central `project_comment` model instead.

If your project still has old `comment_log` fields:

1. Open **Settings → Plugins → Record Comments**.
2. Expand **Advanced settings**.
3. Run **Scan for Legacy Comments**.
4. Review the models found by the scan.
5. Start the migration.
6. After checking the migrated comments, optionally delete the old `comment_log` fields from the same screen.

Avoid editing comments while the migration is running.

## Troubleshooting

**The sidebar says the record must be saved**

Save the record once, then reopen or refresh the sidebar.

**Realtime updates are not working**

Check that realtime updates are enabled in the plugin settings and that a read-only Content Delivery API token has been saved.

**Other editors' comments do not appear immediately**

The plugin is probably running without realtime updates. Reload the record or configure a Content Delivery API token.

**The plugin cannot verify comment storage**

The setup user may not be able to manage models and fields. Ask a project admin to reload the plugin once, or grant the needed schema permissions during setup.

**Comments fail to save**

Check that the current user can create and update records in the internal `project_comment` model.

## Support

- [DatoCMS documentation](https://www.datocms.com/docs)
- [DatoCMS community](https://community.datocms.com/)
- [Report an issue](https://github.com/datocms/plugins/issues)
