# Technical notes

How the plugin scans and deletes assets. For using the plugin, see the [README](../README.md).

## Scan

The plugin lists uploads with the API's `in_use` filter (`filter[fields][in_use][eq]=false`), in pages of 500 ordered by ID. It keeps only each asset's ID, filename, URL and size. Nothing is deleted until the scan finishes and the user confirms the selection.

The confirmation lists the unused assets 100 per page, all selected. Users can untick assets, use Select all, or search by filename. While a search is active, Select all only affects the matching assets, and selected assets hidden by the search are still deleted.

## Deletion

Selected assets are deleted in sequential batches of 100 (the API allows 200 per bulk operation). Right before each batch, the plugin lists the batch's IDs again with the `in_use` filter and only deletes the ones still unused. Assets that are in use again, or were removed elsewhere, are counted as skipped. The bulk delete is an asynchronous job; its `successful` counter gives the deleted count, and the rest of the batch is counted as failed.

Storage freed adds up the sizes of the deleted assets. When a job only partly succeeds, the API doesn't say which assets failed, so the figure is estimated and labeled as such.

Stop, or closing the dialog, prevents further batches; the batch already submitted finishes on the server. An API error ends the run and the summary shows what was deleted, skipped, failed and not processed. Rate limits and transient errors are retried by the CMA client.

## Verification

```sh
npm ci
npm run check
```

`check` runs lint, the production build and the tests. All API traffic in the tests is mocked.

## API contracts

- [Upload pagination and filtering](https://www.datocms.com/docs/content-management-api/resources/upload/instances): maximum 500 entries per page; filter field names use snake case.
- [Batch limits](https://www.datocms.com/docs/content-management-api/errors#TOO_MANY_OPERATIONS): maximum 200 operations per batch.
- [Used-upload protection](https://www.datocms.com/docs/content-management-api/errors#UPLOAD_IS_CURRENTLY_IN_USE): the server rejects deletion of an upload that is in use.
- [Bulk job response](https://www.datocms.com/docs/content-management-api/resources/upload/bulk_destroy?language=http): the final raw response includes `successful` and `failed` counters.
