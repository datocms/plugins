__NEED_NEW_IMAGE__
# Locale Duplicate

A DatoCMS plugin that provides two complementary features for managing
multilingual content:

1. **Mass Locale Duplication** — bulk copy all content from one locale to
   another across selected models.

![88846](https://github.com/user-attachments/assets/3770f94d-4206-450b-bf0b-beebcce6cf44)


2. **Field-Level Copying** — one-click copy buttons on individual localized
   fields while editing a record.

![39050](https://github.com/user-attachments/assets/f12b5e08-8c4b-499f-9ea2-6e2e3269d6d6)

This can be useful when you need to:

- Migrate content from an old locale code to a new one (and optionally remove
  the old locale afterward).
- Duplicate content between two similar locales (e.g., `en-US` and `en-UK`) as
  a starting point before making minor adjustments.
- Selectively copy specific localized field values across locales while
  editing a single record.

## Features

### Mass Locale Duplication

- Pick a source and a target locale from the project's available locales.
- Choose which models participate in the duplication (all are selected by
  default).
- Toggle whether to read draft records (otherwise only published records are
  duplicated).
- Toggle whether to automatically publish updated records after duplication.
- Two-step confirmation flow before any data is touched.
- Live progress view with per-record success/error logs and the ability to
  abort mid-run.
- Final summary view with success/failure counts grouped by model.

### Field-Level Copy

- A copy button is added as an addon on each field selected in the plugin's
  configuration.
- The plugin treats the first locale of the record as the **main locale**:
  - When editing the main locale, the button is labeled
    **Copy to all locales** and copies the current field value into every
    other locale of the record.
  - When editing any other locale, the button is labeled
    **Copy from `<main-locale>`** and copies the main-locale value into the
    current locale.
- The button is hidden on records that only have a single locale.
- Supports string, text, structured text, JSON, SEO, and slug field types.
- Copied editor blocks receive new IDs/Slate keys while links to existing
  records and assets remain intact.

## Configuration

### Mass Locale Duplication

No special configuration required. Open it from
**Configuration → Mass Locale Duplication**.

### Field-Level Copy

1. Open Configuration → Plugins → **Locale Duplicate**.
2. Pick a **Model**, then pick a **Localized Field** from that model
   (non-localized fields are filtered out, and already-configured fields are
   excluded from the dropdown).
3. Click **Add Configuration**, repeat for any other field/model combos.
4. Click **Save Configuration** to persist the list to the plugin parameters.
5. Copy buttons appear automatically on the configured fields when editing a
   record with more than one locale.

The configuration screen also includes a shortcut button that navigates
directly to the Mass Locale Duplication page.

## Usage

### Mass Locale Duplication

1. Navigate to **Configuration → Mass Locale Duplication** in
   your DatoCMS project.
2. Choose the **Source Locale** (the locale that has the content you want to
   duplicate).
3. Choose the **Target Locale** (the locale that will receive the copied
   content).
4. Select which models you want to duplicate:
   - By default, all non-modular-block models are selected.
   - Deselect any models you don't want to include in the run.
5. Optionally toggle:
   - **Use records in draft state** — include draft content in the copy.
   - **Publish updated records automatically after duplication** — bulk
     publishes records that were successfully updated.
6. Click **Duplicate locale content**.
7. Confirm the two prompts: first that you really want to duplicate, then
   that you accept the target locale will be overwritten.
8. Watch the progress view (per-record updates with status, model, and IDs).
   You can **Abort Process** at any time; in-flight changes are kept but no
   further records are touched.
9. Once finished, review the summary view with success/failure counts and
   model totals, publication outcomes, and sampled error details.

### Field-Level Copy

1. Configure fields in the plugin configuration as described above.
2. Open a record in the record editor with more than one locale.
3. On the configured fields:
   - In the main locale, click **Copy to all locales** to push the current
     value into every other locale.
   - In any other locale, click **Copy from `<main-locale>`** to pull the
     main locale's value into the current one.

## Common Use Cases

### Renaming a Locale

1. Create a new locale in **Configuration → Locales** (e.g., add `en-NEW` next to
   the existing `en-OLD`).
2. In the **Locale Duplicate** plugin, choose `en-OLD` as the source and
   `en-NEW` as the target.
3. Run Mass Locale Duplication.
4. Remove the old locale (`en-OLD`) from **Settings → Locales** if desired.

### Setting Up a Similar Locale

If you have a locale like `en-US` and want a similar locale like `en-UK`:

1. Create `en-UK` in **Settings → Locales**.
2. In the plugin, select `en-US` as the source and `en-UK` as the target.
3. Run Mass Locale Duplication.

### Updating Specific Content Types

If you've made major updates to certain models in one locale and want to
propagate only those changes:

1. Select your source and target locales.
2. Deselect every model except the ones you specifically want to update.
3. Run Mass Locale Duplication on the reduced selection.

### Copying a Field Value Within a Single Record

1. Open a record with multiple locales.
2. On a configured field, use **Copy to all locales** (from the main locale)
   or **Copy from `<main-locale>`** (from any other locale) to sync the
   field's localized values without leaving the editor.

## Large projects and reliability

Bulk duplication runs continuously. It discovers record IDs in stable `id_ASC`
order using non-nested pages of 100, then consumes expanded content in pages of
30 with at most three concurrent updates. Discovery retains IDs rather than full
payloads; copying retains one page plus the active workers' payloads. IDs,
publication versions and compact model/schema metadata grow with the selection.
Assets are referenced by ID and metadata, without enumerating or uploading
the asset collection. Each update overwrites only the target locale and preserves
the current values of other locales, including when the source is a published
version. Adding a record locale includes every localized field as required by
the CMA.

Schema-aware copying creates independent nested blocks and preserves record
references, JSON IDs, upload metadata and Structured Text links. Repeating a
copy whose target already matches the source performs no write, even when the
two locales' equivalent blocks have different IDs.

The editor addon checks the record, block, field and editing context before
each locale write. Switching records/blocks or removing a locale stops the
remaining writes. The SDK cannot distinguish two new root forms without IDs
when their other context metadata is identical.

All bulk-run CMA traffic, including asynchronous job polling, shares a 150 ms request
interval. Reads retry transient failures up to four attempts. Writes retry only
explicit rate-limit rejections; a lost or uncertain response is read back rather
than blindly resubmitted. Updates use `meta.current_version` and rebuild after
a stale-version rejection. Publication occurs after copying, in batches of up
to 200, and uses the job's actual successful/failed totals. Changed drafts are
excluded before publication. Jobs are observed for up to ten minutes; outcomes
that cannot be confirmed remain explicitly uncertain.

Abort stops new work and lets active operations settle. The summary retains
confirmed counters, unprocessed records, and pending/uncertain publication
outcomes. Long runs show the latest 500 log entries and the first 100 errors;
total counters remain exact. Large select menus limit rendered search results,
selections above 50 models show a compact count, and large model summaries show
100 rows per page.

The plugin must remain open during a run. The CMA does not provide an atomic
collection snapshot or a publication version lock: collection changes during
discovery can fail a model, and an edit between the publication precheck and the
server operation remains a race. A timed-out server write/job can still finish
after observation ends. Memory for IDs/versions is linear in the selected record
count. API limits still apply, including record size and nested block limits;
copying another locale can exceed those limits. Field addon configuration also
remains subject to the plugin parameter limit of 10 KB.

Official contracts: [CMA limits](https://www.datocms.com/docs/content-management-api/technical-limits),
[nested listing](https://www.datocms.com/docs/content-management-api/resources/item/instances),
[bulk publication](https://www.datocms.com/docs/content-management-api/resources/item/bulk_publish),
[localized updates and locking](https://www.datocms.com/docs/content-management-api/resources/item/update),
and [editor form values](https://www.datocms.com/docs/plugin-sdk/working-with-form-values).

## Development validation

Run from this plugin directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run check` aggregates typecheck, tests and build. Lint touched files using
the repository's Biome configuration. The tests use Node 22.15+ (or Node 24)
and the existing TypeScript compiler; no additional test package is required.

Deterministic mocks cover 200,000 IDs/streamed records, 200,001 publication
references, 10,000 asset references, large locale/model selections, deeply
nested values, Slate/DAST integrity, rate limits, timeouts, partial publication,
stale versions, uncertain outcomes and cancellation. These fixtures validate
control flow and internal bounds; they do not prove production performance.
Verify both Settings duplication and the editor addon in a dedicated DatoCMS
test project before release, including permissions and validation failures.
