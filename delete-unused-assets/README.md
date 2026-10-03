A plugin that allows you to delete all unused assets with the click of a button.

## Large libraries and deletion safety

The plugin scans the entire asset library in sequential pages of 500, using a
stable ID order, then checks usage for groups of 100 IDs. Paginating the full
library prevents edits to record references from moving the scan's offsets.
The API's `in_use` filter supplies usage information; the plugin does not fetch
records, models, localized fields, or nested blocks. It retains only asset IDs,
filenames and URLs, plus a set of IDs seen during discovery.

The confirmation stays the same for small selections. Above 100 assets, its
preview shows 100 assets per page. Delete still processes the entire confirmed
selection. Newly created assets are never added to that selection after
confirmation.

Deletion runs continuously in sequential batches of 100, below the API's limit
of 200 operations. Each batch rechecks usage before submitting, waits for the
asynchronous job, retains its `successful`/`failed` counters, and reconciles the
remaining IDs. Used assets are kept; assets already removed are counted
separately. Completed partial jobs can automatically retry their remaining
unused IDs, up to three attempts per batch. Counts and errors prevent a partial
result from displaying an unconditional success notice.

API reads and rate-limit rejections receive bounded exponential retries (five
attempts), respecting `Retry-After`/`X-RateLimit-Reset`. Each fetch, including its
response body, has a 30-second abort timeout. A write is retried only after an
explicit HTTP 429 rejection. Lost write responses and failed job polling never
resubmit the mutation: they stop further batches, reconcile what can be read,
and report an uncertain outcome. Job polling continues automatically at
two-second intervals for approximately one hour before reporting an unknown
outcome; its last request can extend that deadline through bounded retries.
API errors shown in the UI omit tokens, request bodies and raw error details.

For large selections, Stop finishes and accounts for the current submitted
job, then prevents further mutations. Unmounting also prevents further batches.
There is no pause, checkpoint or manual continuation workflow. A job already
accepted by DatoCMS cannot be cancelled by closing the plugin, and may still
finish on the server.

Discovery automatically retries up to three complete scans if counts,
duplicate IDs or a short page indicate structural changes to the asset
library. Failed or incomplete discovery never enables Delete. Offset pagination
does not provide a snapshot: simultaneous external asset creation/deletion
that preserves counts may still escape those checks. Usage is revalidated and
DatoCMS rejects deletion of used uploads, but this plugin cannot provide an
atomic snapshot across the whole operation. The current environment and user
permissions determine which assets are visible and deletable. Assets referenced
only by external applications or arbitrary URLs are outside the API's usage
index. Older historical record versions are outside the current/published
usage contract used by this plugin.

## Verification

Run commands from this plugin directory:

```sh
npm ci
npm run typecheck
npm run check
```

`check` aggregates lint, production build and deterministic tests. Tests cover
a lazily generated 10,000-asset library, server-side usage fixtures representing
current/published references, many models/locales and nested blocks in a
200,000-record project, complete deletion coverage, bounded rendering, partial
failures, retries, cancellation, lost responses and job polling. All API traffic
is mocked. These fixtures validate client behavior, not the server's reference
index or production throughput, latency and browser memory. No production
credentials or real DatoCMS mutations are needed. The repository's existing
`run-checks.js` targets other plugins and does not include this package.

## API contracts checked for this implementation

- [Upload pagination and filtering](https://www.datocms.com/docs/content-management-api/resources/upload/instances): one page per `list` call, maximum 500 entries; filter field names use snake case.
- [Batch limits](https://www.datocms.com/docs/content-management-api/errors#TOO_MANY_OPERATIONS): maximum 200 operations per batch.
- [Used-upload protection](https://www.datocms.com/docs/content-management-api/errors#UPLOAD_IS_CURRENTLY_IN_USE): the server rejects deletion of an upload that is in use.
- [Bulk job response](https://www.datocms.com/docs/content-management-api/resources/upload/bulk_destroy?language=http): final raw response includes successful and failed counters.
- [Asynchronous jobs](https://www.datocms.com/docs/content-management-api/async-jobs) and [rate limits](https://www.datocms.com/docs/content-management-api/technical-limits): polling semantics and rate-limit handling.

The local API source was also inspected read-only: `Upload::MAX_BATCH_UPLOADS`,
`Api::Cma::Upload::Destroy`, `Upload::BulkOperation`, and `Gql::UploadField::InUse`.
That snapshot includes current and published references and environment-owned
assets in usage checks, and a transactional lock before deletion. This was not
verified against a running production server. The original camel-case `inUse`
is normalized by the current backend; the new `in_use` spelling follows the
documented contract rather than fixing a proven filter failure.
