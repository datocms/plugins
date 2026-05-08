# Sidebar Todo Lists

Turn a JSON field into a simple, editable to-do list inside your records. Tasks can be added, reordered, marked as done, and deleted; completed tasks are collapsed under a "Show completed" toggle.

## Configuration

[Apply this plugin as the editor of a JSON field](https://www.datocms.com/docs/plugins/install/#assigning-a-plugin-to-a-field). Per-field, you can specify the initial tasks shown on new records (one per line):

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/todo-list/docs/settings.png)

### Stored value

The JSON field stores an object with two arrays of tasks:

```json
{
  "incomplete": [
    { "id": "uuid", "todo": "Write the README", "completedAt": null }
  ],
  "complete": [
    { "id": "uuid", "todo": "Set up the repo", "completedAt": "2025-01-01T12:34:56.000Z" }
  ]
}
```

## Changelog

- 0.0.17 - Fixed the plugin getting stuck on "Loading the plugin…" when served from the DatoCMS plugins CDN. The Vite build was emitting absolute asset paths (`/assets/…`) that 404'd from the per-plugin subdirectory; now configured with `base: './'` so the bundled `index.html` references its assets relatively.
