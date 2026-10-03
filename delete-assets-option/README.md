# Delete Assets Option

Prompts users to delete assets only referenced in the records they are deleting.

The existing **Keep / Delete** confirmation is unchanged. Asset cleanup runs
continuously after selecting Delete; no manual pause, checkpoint or resume is
required. For large selections (500 records or 500 discovered assets), a compact
progress modal shows collection. It closes before the dashboard's native
confirmation, then progress notifications follow record deletion and asset cleanup.
Canceling cleanup stops future asset batches, while the dashboard's record
deletion and any asset job already submitted may finish.

## Collection and safety

- Collects only the selected records, through ID batches of 100 and fully
  paginated nested responses of at most 30 records. Current and published
  versions are inspected, including every locale, SEO images and nested blocks.
- Loads and caches field definitions only for encountered models. Arbitrary JSON,
  file metadata, URLs in text and links to other records are not interpreted as
  asset references. Records are processed incrementally rather than retained.
- Deduplicates assets globally. Four request slots and a shared 10 requests/second
  scheduler bound pressure on the CMA, including retries and job polling.
- Releases the SDK before hook so the dashboard can delete records, then polls
  the selected IDs until they are no longer visible. There is no fixed-delay
  assumption and no scan of all project records. Thirty minutes without record
  deletion progress stops cleanup and preserves assets.
- Submits asset batches of at most 100, below the backend's 200-asset bulk limit.
  The CMA's atomic deletion guard retains assets referenced by current/published
  records or environment settings, including references invisible to the user.
  The plugin never forcibly removes references.
- Waits for each bulk job, uses its raw success count and checks remaining assets.
  Shared or forbidden assets, already unavailable assets and unconfirmed results
  are reported separately. An accepted write with a lost response is not replayed.
- Requests abort after 20 seconds; safe reads and rejected rate-limited requests
  retry automatically up to five attempts with backoff and server cooldowns.
  Each request has a four-minute total budget and each bulk job a thirty-minute
  observation deadline. A late job may finish after an unconfirmed result.

## Validation

Run from this plugin directory:

```sh
npm ci
npm run typecheck
npm run check
```

`check` aggregates Biome lint, the TypeScript/Vite build and Vitest. Deterministic
tests use synthetic records generated one page at a time, including 200,000
logical records and 10,000 assets, shared references, partial failures, retries,
timeouts, cancellation, locales and nested blocks. They make no DatoCMS requests.

The repository's `run-checks.js` targets other plugins, installs packages and
uses legacy scripts; it does not validate this plugin.

## External limits and remaining checks

The dashboard's native bulk record deletion has a 200-record limit. This plugin
can work in a project containing 200,000 records without loading that whole
project; it does not expand the dashboard's selection or bulk deletion limits.
The SDK supplies the selected records, so their initial host payload is outside
the plugin's memory control.

Cleanup requires the plugin's boot iframe to remain alive. Reloading the
dashboard, logging out or changing environments can interrupt the browser task.
If another plugin or a later dashboard confirmation cancels record deletion,
assets remain protected and observation eventually times out. Read permission
changes can hide records/assets; absence in a query is not itself proof of
deletion, and the CMA's deletion guard remains the final safety boundary.

Synthetic tests do not establish production throughput, browser memory usage or
the deployed server version. Integration with the live dashboard and server
reference locks must still be verified in an isolated development project.

Official references: [CMA limits and rate limits](https://www.datocms.com/docs/content-management-api/technical-limits),
[record listing](https://www.datocms.com/docs/content-management-api/resources/item/instances),
[upload listing](https://www.datocms.com/docs/content-management-api/resources/upload/instances),
[bulk asset deletion](https://www.datocms.com/docs/content-management-api/resources/upload/bulk_destroy),
and [SDK event hooks](https://www.datocms.com/docs/plugin-sdk/event-hooks).
The 200-operation limits and atomic reference guard were also checked against
the local DatoCMS API source; the public bulk endpoint documentation does not
state its batch limit or transactional behavior.
