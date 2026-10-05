# Bulk Change Author

Changes the creator of many records at once from a model's table view. The new creator can be any collaborator, SSO user or the project owner.

## Usage

Install the plugin and allow it to use the current user's API token. Changes are made as you, so your role needs the "Edit creator" permission on the models involved. A 403 error usually means it's missing.

Open a model's table view, select the records, and choose **Change creators…** from the selection's dropdown menu. Pick the new creator and confirm. When it's done you'll see how many records were updated and the errors for any that failed. The action isn't available from a single record's page.

Only the creator changes. The records aren't published and their content isn't touched.

## Large selections

Records are updated one at a time, at about 10 per second, so very large selections take a while (around five and a half hours for 200,000 records). For 500 records or more the dialog shows progress and a **Stop** button. Keep the browser window open until it finishes.

If the plugin loses the response for an update and can't confirm whether it went through, it stops and reports those records as uncertain. Check their creators before running the action again on them.

## Development

```bash
npm install
npm run dev
npm run check
```
