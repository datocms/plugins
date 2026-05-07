# DatoCMS Tag editor plugin

A plugin that transforms single-line string and JSON fields into tag editors. Tags can be added, removed, and reordered via drag-and-drop directly inside the record editor.

## Supported field types

- **Single-line string**: tags are stored as a comma-separated list (e.g. `red, green, blue`).
- **JSON**: tags are stored as a JSON array of strings (e.g. `["red", "green", "blue"]`).

## Manual setup

Once installed, the plugin registers a manual field extension called **Tag Editor** that you can [apply to any single-line string or JSON field](https://www.datocms.com/docs/plugins/install/#assigning-a-plugin-to-a-field) via the field's "Presentation" tab.

## Automatic apply rules

From the plugin configuration screen you can also define rules so the editor is applied automatically to every field whose API key matches a regular expression. Each rule consists of:

- **Field types**: any combination of "Single-line string" and "JSON field".
- **API key (regexp)**: a regular expression matched against the field's API key.

Whenever a field matches one of the rules, the Tag editor presentation is applied without having to set it manually on each field.
