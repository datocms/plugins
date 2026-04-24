# Record Auto-save

Record Auto-save saves dirty DatoCMS records automatically after a configurable interval.

![Record Auto-save settings](https://raw.githubusercontent.com/datocms/plugins/master/record-auto-save/docs/settings.png)

## Features

- Enable auto-save only for the models you choose.
- Set the auto-save interval in seconds.
- Optionally show a notification after each auto-save.
- Optionally debounce auto-save so the timer starts after the editor stops changing the record.

## Setup

1. Install the plugin in your DatoCMS project.
2. Open the plugin settings.
3. Select the models where auto-save should run.
4. Set the auto-save interval.
5. Save the settings.

## How it works

When a selected record has unsaved changes, the plugin waits for the configured interval and then saves the record.

If **Only start timer after user stops modifying record (Debounce)** is enabled, the timer restarts after each edit and only saves once editing pauses.

## Notes

- Auto-save only runs on models selected in the plugin settings.
- The interval must be at least 1 second.
- New settings apply after saving the plugin configuration.
