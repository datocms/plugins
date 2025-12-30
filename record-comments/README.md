# Record Comments

A DatoCMS plugin for team collaboration through threaded comments on records and a project-wide Comments Dashboard.

## Features

### Record Sidebar
- Threaded comments on any record
- Upvote system
- Edit & delete your comments
- Realtime updates

### Comments Dashboard
- Global project-wide discussions
- My Mentions — see where you've been tagged
- Recent Comments — latest activity across the project
- Search and filter by author, date, records, assets, models, or users

### Mentions
| Trigger | Type |
|---------|------|
| `@` | User |
| `#` | Field |
| `&` | Record |
| `^` | Asset |
| `$` | Model |

## Installation

1. Go to **Settings → Plugins** in your DatoCMS project
2. Search for "Record Comments" and click **Install**

## Configuration

To enable realtime updates:

1. Go to **Settings → API Tokens**
2. Copy your **Read-only API token**
3. Go to **Settings → Plugins → Record Comments**
4. Paste the token and click **Save**

## Usage

### Record Comments
1. Open any record and expand the **Comments** panel in the sidebar
2. Type your message and press **Enter** to send

> Note: Save the record at least once before adding comments.

### Dashboard
Click **Comments** in the left sidebar to access project-wide discussions, your mentions, and recent activity.

### Mentions
Type a trigger character (`@`, `#`, `&`, `^`, `$`) followed by a search term, or use the toolbar buttons.

## Troubleshooting

**Comments not syncing in realtime?**
- Check that a CDA token is configured in plugin settings

**Can't add comments?**
- Save the record at least once first

## Support

- [DatoCMS Documentation](https://www.datocms.com/docs)
- [DatoCMS Community](https://community.datocms.com/)
- [Report Issues](https://github.com/datocms/plugins/issues)
