# All Records Viewer

Browse records from every model in one paginated table.

## Usage

Open **Content → All Records** to search, filter by model or status, sort columns, and choose which columns to display.

![The All Records table showing records from several models](docs/all-records.png)

Select records to publish, unpublish, delete, or move to a workflow stage when available. To act on more than the current page, use **Select all matching records**, which selects everything matching the current filters. Changing filters afterwards keeps your selection.

![Bulk actions for the selected records](docs/bulk-actions.png)

## Large selections

Actions on large selections are sent in batches of up to 200 records, so they can take a while. **Cancel remaining** stops after the batch in progress.

If a batch fails, its records stay selected. Some of them may have been updated anyway, so check their state before running the action again.

## Development

```sh
npm install
npm run dev
npm run test
npm run build
```

See [docs/scale-audit.md](docs/scale-audit.md) for how large projects and selections are handled.
