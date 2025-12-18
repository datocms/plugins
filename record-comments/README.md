# Record Comments

A DatoCMS plugin that enables team collaboration through threaded comments on any record. Discuss content, leave feedback, and keep conversations organized—all within your DatoCMS editing experience.

![Record Comments Cover](docs/cover.png)

## Features

- 💬 **Add comments** to any record in your project
- ↩️ **Threaded replies** for organized conversations
- 👍 **Upvote system** to highlight valuable feedback
- ✏️ **Edit & delete** your own comments
- ⚡ **Realtime updates** — see new comments instantly without refreshing
- 🖼️ **Gravatar integration** — automatic profile pictures for commenters
- 🔒 **Author-only editing** — users can only modify their own comments

## Demo

https://github.com/user-attachments/assets/your-demo-video

## Installation

1. Go to **Settings → Plugins** in your DatoCMS project
2. Click **Add new plugin**
3. Search for "Record Comments" in the marketplace
4. Click **Install**

The plugin will automatically create a `project_comment` model to store all comments. This keeps your content models clean while providing a centralized location for collaboration data.

## Configuration

### Setting up Realtime Updates

To enable realtime updates (seeing new comments instantly), you need to provide a Content Delivery API (CDA) token:

1. Navigate to **Settings → API Tokens** in your DatoCMS project
2. Copy your **Read-only API token** (CDA token)
3. Go to the plugin settings (**Settings → Plugins → Record Comments**)
4. Paste your CDA token and click **Save Settings**

> **Note:** Without a CDA token, the plugin will still work but won't show realtime updates from other users.

## Usage

### Adding Comments

1. Open any record in your DatoCMS project
2. In the sidebar on the right, click the **Comments** panel to expand it
3. Click **"Add a new comment..."** to create a new comment
4. Type your message and press **Enter** to save

> **Important:** You must save the record at least once before adding comments.

### Replying to Comments

Click the **reply icon** (↩️) on any comment to add a threaded reply. Replies are nested under the parent comment for easy tracking.

### Upvoting Comments

Click the **upvote arrow** (⬆️) on any comment to show agreement or mark it as helpful. Click again to remove your upvote.

### Editing & Deleting

- Click the **pencil icon** (✏️) to edit your comment
- Click the **trash icon** (🗑️) to delete your comment

You can only edit or delete comments you authored.

## How It Works

### Data Storage

Comments are stored in a dedicated `project_comment` model that is automatically created when the plugin is installed. Each record contains:

| Field | Description |
|-------|-------------|
| `model_id` | The ID of the model the commented record belongs to |
| `record_id` | The ID of the record being commented on (unique) |
| `content` | JSON array containing all comments and replies |

### Comment Structure

Each comment object contains:

```json
{
  "dateISO": "2024-01-15T10:30:00.000Z",
  "comment": "This looks great! Just one small suggestion...",
  "author": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "usersWhoUpvoted": ["jane@example.com"],
  "replies": []
}
```

### Realtime Subscriptions

When configured with a CDA token, the plugin uses DatoCMS's realtime GraphQL subscriptions to detect changes. When another user adds, edits, or deletes a comment, all viewers see the update instantly.

## Migration from Legacy System

If you previously used an older version of this plugin that stored comments in a `comment_log` JSON field on each model, you can migrate to the new centralized system:

1. Go to the plugin settings (**Settings → Plugins → Record Comments**)
2. Click **"Scan for Legacy Comments"** to find models with `comment_log` fields
3. Review the found models and click **"Start Migration"**
4. After migration completes, optionally delete the old `comment_log` fields using the cleanup tool

> **⚠️ Warning:** Ensure no one is editing comments during migration to avoid data loss. The cleanup action is irreversible.

## Permissions

This plugin requires the `currentUserAccessToken` permission to:

- Create the `project_comment` model on first install
- Read and write comment records
- Identify the current user for authoring comments

## Development

### Local Setup

```bash
# Clone the repository
git clone https://github.com/datocms/plugins.git
cd plugins/record-comments

# Install dependencies
npm install

# Start development server
npm run dev
```

### Building

```bash
npm run build
```

The built plugin will be in the `dist/` directory.

### Project Structure

```
src/
├── main.tsx                    # Plugin entry point & SDK connection
├── entrypoints/
│   ├── CommentsBar.tsx         # Main sidebar panel component
│   ├── ConfigScreen.tsx        # Plugin settings page
│   └── components/
│       └── Comment.tsx         # Individual comment component
├── styles/
│   ├── commentbar.module.css
│   ├── comment.module.css
│   └── configscreen.module.css
└── utils/
    └── render.tsx              # React rendering utility
```

## Dependencies

- [`datocms-plugin-sdk`](https://www.npmjs.com/package/datocms-plugin-sdk) — DatoCMS plugin SDK
- [`datocms-react-ui`](https://www.npmjs.com/package/datocms-react-ui) — DatoCMS React UI components
- [`react-datocms`](https://www.npmjs.com/package/react-datocms) — React hooks for DatoCMS (realtime subscriptions)
- [`@datocms/cma-client-browser`](https://www.npmjs.com/package/@datocms/cma-client-browser) — DatoCMS Content Management API client

## Support

- 📚 [DatoCMS Documentation](https://www.datocms.com/docs)
- 💬 [DatoCMS Community](https://community.datocms.com/)
- 🐛 [Report Issues](https://github.com/datocms/plugins/issues)

## License

MIT © [DatoCMS](https://www.datocms.com)
