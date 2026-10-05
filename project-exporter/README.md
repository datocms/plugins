# Project Exporter

Exports your project's records as JSON, CSV, XML or XLSX, and your assets as ZIP files, straight from the DatoCMS dashboard.

![Project Exporter cover](docs/cover.png)

## Usage

Install the plugin (package name `datocms-plugin-project-exporter`) and allow it to use the current user's API token. Then open **Configuration → Plugins → Project Exporter**.

Pick a format at the top of the screen. It's saved and used for every export, including single records. Click **Download all records** to export everything, or open **Filtered export** to export only some models or the records matching a text search. **Download all assets** packages your media library into ZIP files.

To export one record, open it and click **Download this record** in the **Record Downloader** sidebar panel.

## Large exports

Big exports are split into numbered files that download one after another, so let your browser download multiple files and keep the plugin open until it's done. A split record export ends with a `.manifest.json` file listing every part. If that file ends in `.incomplete.json` instead, the export was cancelled or failed partway and isn't a complete backup.

The plugin reads live data, so avoid editing content while an export runs.

Each asset ZIP holds up to 150 MiB and 100 files. Assets that can't be downloaded, including single files too big for the browser to handle, are skipped and listed in a JSON report. For those, use the [official export tools](https://www.datocms.com/docs/import-and-export/export-data).

XLSX cells can't hold more than 32,767 characters. If a record has a longer value, the XLSX export stops with an error rather than truncating it, so use another format.

## Export format

JSON is the format to use if you plan to import the data somewhere else. Each JSON file contains the `records` as the Content Management API returns them, nested blocks included, plus:

- `manifest`, with the source project, environment, locales and filters used
- `schema`, with models, fields, and maps from their IDs to API keys
- `projectConfiguration`, with site settings, fieldsets, menus, model filters, plugins, workflows, roles, webhooks, build triggers and scheduled publications
- `referenceIndex`, listing every link, asset, block and Structured Text reference in the records with its JSON path

In a split export, every part repeats the schema and configuration, and reference paths point into that part's `records`. Configuration the plugin couldn't read is listed in `projectConfiguration.warnings`.

CSV, XML and XLSX files contain only the records. In CSV and XLSX each top-level record property gets a column, and localized values, blocks and other nested data are stored as JSON inside the cell.

Each asset ZIP names files `u_<uploadId>__<filename>` and includes a `manifest.json` mapping every file to its original upload ID, filename and metadata. To rebuild a project, import the assets first and map old upload IDs to new ones, then create the records, then resolve links with `referenceIndex`.

## Development

```sh
npm ci
npm run dev
npm run test:ci
npm run build
```

## License

MIT
