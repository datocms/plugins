# Tree-like Slugs

Automatically propagate hierarchical slugs through parent-child records in DatoCMS.

When you update a parent record's slug, all descendant records (children, grandchildren, etc.) automatically inherit the updated path prefix.

## Example

**Before updating the grandparent's slug:**

```
Grandparent: /grandparent
  └── Parent: /parent
        └── Child: /child
```

**After updating the grandparent's slug to `/grandparent-new`:**

```
Grandparent: /grandparent-new
  └── Parent: /grandparent-new/parent
        └── Child: /grandparent-new/parent/child
```

## Setup

1. Install the plugin from the DatoCMS marketplace
2. Ensure your model uses **Hierarchical sorting** as its default ordering
3. On your slug field, **disable** the "Match a specific pattern" validation (required to allow `/` characters)
4. Add this plugin as a field addon to your slug field

## Large hierarchies

The plugin reads the affected model in pages of 100 records, ordered by ID, and
keeps only record IDs, parent IDs, versions, and validation flags between pages.
It validates the affected hierarchy and proposed parent changes for cycles before
writing. Traversal is iterative, so deep trees do not create recursive calls or
retain every ancestor's full slug path. Leaf edits use the server's `has_children`
flag to avoid scanning the model.

Up to four descendant operations run at once. All clients in the plugin share
request pacing of approximately ten requests per second. Transient reads retry
automatically with backoff; writes use optimistic locking and reread uncertain
results before retrying. Each operation has at most six attempts. Only affected
slug fields are written, with unaffected locales preserved. Already correct slugs
are left untouched. Missing slug values/locales stop inheritance for that branch
and field/locale without manufacturing values. Assets and nested block content
are not fetched separately or rewritten.

Execution stays continuous. For operations involving at least 1,000 records,
temporary notifications report loading counts and confirmed descendant progress,
including while requests are waiting. There is no manual pause/resume workflow.

## Failure behavior and practical limits

- Propagation failures block the parent save. All started descendant operations are awaited
  before the plugin reports its confirmed progress. Successful child updates
  remain saved; a request with an unconfirmed result can also have reached the
  server. The plugin does not promise a rollback or a multi-record transaction.
- The SDK hook runs **before server-side validation** of the parent. If the parent
  subsequently fails validation, or another plugin blocks its save, descendants
  may already have been updated. The SDK provides no after-save hook to make this
  operation atomic.
- Versions protect records that change during processing. A count change,
  duplicate, or incomplete pagination response stops loading before writes.
  Offset pagination is not a transactional snapshot: concurrent tree changes can
  still add or move descendants after discovery. Saves in this plugin's boot
  iframe are serialized by environment; this does not lock other browsers/API clients.
- The index uses memory proportional to the model's record count. The API has no
  documented field projection, so one page's unrelated fields are still received
  before being discarded. Active path memory also depends on tree width and slug
  length. Record and slug validation limits still apply to very long paths.
- Updating 200,000 descendants requires about 400,000 individual read/write
  requests, plus parent revalidations, model pages, and any retries. With conservative pacing this can
  take many hours. The browser and the SDK hook must remain active; no guaranteed
  host execution duration is documented.

API behavior follows the official [record listing and page limits](https://www.datocms.com/docs/content-management-api/resources/item/instances),
[CMA rate limits](https://www.datocms.com/docs/content-management-api/technical-limits),
[optimistic locking](https://www.datocms.com/docs/content-management-api/resources/item/update),
and [SDK event hooks](https://www.datocms.com/docs/plugin-sdk/event-hooks).

## Development validation

Run `npm run check` inside this plugin to run lint, typecheck, deterministic tests,
and the production build. Tests include a 200,000-record synthetic model generated
page by page, a 12,000-level chain, cycles, concurrent edits, localized fields,
partial failures, cancellation, rate limits, and uncertain write responses.
These mocks establish correctness and bounded scheduling; they do not prove
production throughput, browser memory usage, or the dashboard's execution duration.

## Known Limitations

- **Reset button**: Clicking the reset/refresh button on the slug field will reset it to the default value, losing the hierarchical path.
- **Moving records**: Dragging a record to a new parent in the tree does not automatically update the slug. To fix this, manually edit and save the new parent record's slug.
