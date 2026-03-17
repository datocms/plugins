# Record Comments

A DatoCMS plugin for threaded comments directly in the record sidebar.

## Features

- Threaded comments on any record
- Replies, upvotes, editing, and deletion
- Realtime updates
- Rich mentions for users, fields, records, assets, and models

## Mention commands

| Command | Type | Description |
|---------|------|-------------|
| `/user` | User | Mention a team member |
| `/field` | Field | Reference a field |
| `/record` | Record | Link to a record |
| `/asset` | Asset | Link to an asset |
| `/model` | Model | Reference a model |

Type `/` to open the command menu, or type a full command directly (for example `/user john`) to search inline.

## Installation

1. Go to **Settings → Plugins** in your DatoCMS project
2. Search for **Record Comments**
3. Install the plugin

> The first time the plugin boots, it creates or verifies an internal
> `project_comment` model used to store comments. Make sure the current user has
> enough permissions to manage models and fields during that initial setup.

## Configuration

To enable realtime updates:

1. Go to **Settings → API Tokens**
2. Copy a **read-only API token**
3. Open **Settings → Plugins → Record Comments**
4. Paste the token and save

## Usage

1. Open any record and expand the **Comments** sidebar panel
2. Write a comment and press **Enter** to send
3. Use `/` or the toolbar buttons to insert mentions

> Save the record at least once before adding comments.

## Troubleshooting

**Comments are not syncing in realtime**
- Check that a CDA token is configured in plugin settings

**Comments cannot be added**
- Save the record at least once first

**Initialization warning about comment storage**
- Ensure the current user can create and inspect models/fields in the project
- Reload the plugin after permissions are fixed so it can verify the internal `project_comment` model

## Support

- [DatoCMS Documentation](https://www.datocms.com/docs)
- [DatoCMS Community](https://community.datocms.com/)
- [Report Issues](https://github.com/datocms/plugins/issues)
