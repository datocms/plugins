# Validation

Automated tests use controlled SDK/CMA fixtures and mocked HTTP responses. They do not establish successful operation inside a real DatoCMS iframe or verify live HTTP checks. Record those checks separately below.

## Automated checks

Run from the plugin directory:

```sh
npm test
npm run lint
npm run build
```

| Area | Coverage |
| --- | --- |
| Extraction | URL-like strings and prose; Markdown references, entities and code exclusion; HTML anchors; DAST links; nested blocks; locale selection; raw CMA and unsaved payloads; unsupported fields; missing schema and malformed content. |
| URL preparation | Absolute HTTP(S) scope, normalization, fragments, query preservation, malformed destinations and skipped destination classes. |
| Requests | HEAD success, GET fallback, conservative status classification, failed requests, timeouts, cancellation and omitted browser credentials. Reading the start of unclear answers (bounded in size and time) to recognize bot protection (Cloudflare challenge and block pages, DataDome captchas, LinkedIn's non-standard status as the proxy reports it) as Blocked, rate limits and sign-ins as Blocked, a domain that doesn't exist as Broken, invalid certificates and unresponsive sites from the proxy's edge errors without reporting their status as the site's, and the proxy refusing the plugin's address; other 403s (such as private S3 objects) and server errors stay Unverified. |
| Queue | Global and hostname concurrency limits, deduplication, cancellation, adapter failures and reusable drain completion. |
| Content reads | Current nested versions, bounded pagination, inconsistent or missing page metadata, permissions, cancellation and record title conversion. |
| Schema | Recursive block discovery, caching, retry after failures and model permission filtering. |
| Session state | Repeated URL occurrences, partial coverage, cancellation, stale content, rechecks, context changes, unmounting and late callbacks. |
| View model | Needs-attention membership including stale URLs, combined status/model/locale/URL filtering where one occurrence must match every filter, severity and record-count sorting, status counts, filter dimensions, scan progress and its share of the work (a page of records weighing like a URL, invalid and skipped URLs counted as done, unknown while records are read without a count), records grouped per URL, cached URL facts and pagination windows. Location, locale-name, plural, date and name-list formatting. Reading warnings as displayed: path separators, locale names, the form reader's repeated suffix and its still-loading message. Break points in long URLs. Scope validation, resolution against readable models and site locales, and scope labels, including two-model, two-locale and single-locale sites. Locations split into field, surrounding fields and blocks, and locale (top-level fields, repeated container labels, missing locales), and read in that order for accessible names. |
| Report view | Default needs-attention view, model/locale/search/status filters, hidden single-value filters, clearing filters, filtered export dispatch and disabled export for empty reports, row selection and the Info sidebar, recheck availability, fragment and stale notes, complete/incomplete/canceled summaries with the scope leading their facts, the running state with a progress bar as the only loading indicator: centered until a URL needs attention, with no filter row, table or footnote; above the results once one does, staying there and never moving backwards; the summary at the top when a scan ends with nothing needing attention; sweeping without a record count; and cancellation, "Choose what to scan…" opening the scope dialog and disabled with its reason while a scan runs or a URL is rechecked, focus returning to it when a recheck ends, Used in places with their field, locale and surrounding fields and blocks (locales only on multi-locale sites) read as the record row's description, pagination and page size, keyboard selection, sorting by the Status heading through ascending, descending and unsorted, reasons in the Link panel only for Unverified, Invalid and Skipped, invalid and skipped URLs counted as settled in the running progress, the current page kept when a filtered list shrinks and grows, empty reports, canceled scans without URLs left to the coverage callout, coverage warnings as displayed, the "No links found" slate's docs link and scan controls disabled during a recheck. The overlay closing only on presses that start on its backdrop, the report left inert under it, and the overlay staying closed when the frame narrows or a report mounts in a narrow frame. The footer's page window sized to the main pane. Picking a filter option with the arrow keys and Enter from the menu's search field, and the focused option with Enter, with the real `datocms-react-ui` menu. |
| Project page | Missing-token and no-readable-model states, the empty-environment link to Schema for roles that can edit the schema, first run and full scans with the blank slate's "Scan links" as the pane's only one, one extra request counting the records for the progress bar, the summary naming the scope, a scan dialog that fails to open, the scope dialog round trip, native editor dispatch and stale marking after a save, editor failures, partial scans, model read failures and their messages, cancellation, rechecks that keep the rechecked row in a filtered view and keep "Recheck URL" with a spinner on the pending button, scan controls disabled with their reasons during a recheck, full-report export (with the rechecked URL's previous result during a recheck) and export failures. The overlay Info sidebar in narrow frames: opening from a row without remounting the table, closing with Esc, and focus returning to the selected row. Focus moving to the toolbar's new action when a scan starts and when it's canceled. |
| Scope modal | Default all-content scope, a turned-on limit with nothing selected showing "Field is required" and focusing its select instead of submitting, prefilled limited scopes, single-locale sites and invalid parameters. The selects' names come from their `aria-label`, as the kit's label points at react-select's container. |
| Record UI | New and unsaved content, no automatic saves or field writes, every locale of the record checked without a locale switch (a value the form holds for a locale the record doesn't have is left out), no intro above the button, result URLs that open in a new tab, place rows that go to their field, a still-loading form, host and SDK failures reported in plain words (a record that couldn't be read, fields that couldn't be loaded) and checked again, stale results, a form locale change that leaves results current, cancellation, the live region's settled summary, records without links, single-locale sites, navigation without enabling a locale removed after the check and navigation failures. |
| Config screen | Intro without a heading, navigation to the project page in primary and sandbox environments, navigation failures, and the missing-permission warning with its next step and no link to the page. |
| Plugin hooks | The Link checker page listed in the Content area only with the current-user API permission, and the record panel's initial height on single-locale and multi-locale sites. |
| CSV | Occurrence rows, raw status keys, incomplete and stale state, escaping and spreadsheet formula protection. |

### Execution record

#### Scale audit (2026-10-02)

This audit and implementation were restricted to this plugin. Existing UI validation records below are historical evidence, not a live validation of these scale changes. No real DatoCMS entities, tokens or production services were used, and no dependencies were installed.

The initial risks were repeated scans of a hostname-skewed pending queue, growing copies of shared-link occurrence arrays on each progress update, unbounded SDK rate-limit retries, unbounded count-query model lists, and expanded detail/warning lists and whole-string CSV exports that could exhaust the browser. Nested record pagination already used the correct page limit and overlapping pages; that behavior was retained and checked for duplicate or repeated API pages.

| Changed files | Scale behavior |
| --- | --- |
| `src/data/cmaRequests.ts`, `src/data/records.ts`, `src/data/formRecord.ts` | Read-only CMA requests have four total attempts for transient failures, cancellable backoff and a 30-second transport/body deadline. Record and count reads share request pacing and a rate-limit cooldown. Nested pages remain limited to 30 records; IDs are deduplicated, pagination metadata is validated, and inconsistent pages produce an incomplete result. Canceling aborts the plugin's actual fetch transport and observes late outcomes. |
| `src/data/schema.ts`, `src/extraction/extract.ts`, `src/project/scanProject.ts` | Schema dependencies use an iterative, cached traversal; unavailable block schemas and isolated malformed records produce explicit coverage warnings while readable content continues. Sparse localized values are visited once. Record counting uses distinct-model batches of at most 50 IDs and 1,500 encoded characters with `limit: 0`. Discovery automatically waits when the URL backlog reaches 1,000 entries, and yields to browser tasks during CPU work. A single record can exceed that backlog threshold before the next capacity check. |
| `src/checking/queue.ts`, `src/checking/client.ts`, `src/checking/url.ts` | Hostname queues use amortized constant-cost dequeue and fair dispatch, retaining the existing four global checks and one check per hostname. Checks have one HEAD, a GET fallback and at most two additional safe GET attempts for temporary failures. Each request has a 10-second deadline; unclear bodies are read only up to 16 KiB and three seconds, then transfers are canceled. Retry-After accepts seconds or HTTP dates. Short hostname cooldowns wait automatically without occupying a global worker slot; delayed hosts share one timer and a heap of deadlines. A confirmed proxy rejection of this plugin's origin ends subsequent checks explicitly as unavailable, avoiding repeated requests that cannot succeed from the same origin. |
| `src/state/session.ts`, `src/state/useScan.ts`, `src/state/group.ts`, `src/report/view.ts` | Progress snapshots capture immutable occurrence lengths lazily; cached metadata avoids copying or scanning a shared URL's whole history for common views. Staleness is tracked incrementally, updates preserve lazy getters without retaining chains of old groups, repeated raw URL preparation has a bounded cache, and large reports publish updates less often, up to every two seconds. Duplicate URL variants do not create duplicate search metadata. |
| `src/project/ReportLayout.tsx`, `src/project/UsedInPanel.tsx`, `src/project/CoverageCallout.tsx`, `src/project/ScanProgressBlock.tsx`, `src/panel/PanelResults.tsx`, `src/panel/PanelNotes.tsx`, `src/entrypoints/ScopeModal.tsx` | Model-selection lookups use maps/sets. Detail previews allocate only visible records and a bounded number of places per record. Large detail and warning lists use 50-item pages; ordinary lists keep their existing behavior. URL search is deferred. Scanning progress stays below 100% until completion and remains indeterminate when no reliable count is available. Its URL counter says "processed" because terminal classifications include destinations that cannot be requested; the percentage estimates record-page work plus URL work rather than elapsed time or exact HTTP requests. |
| `src/utils/csv.ts`, `src/entrypoints/ProjectPage.tsx`, `src/project/PageToolbar.tsx` | CSV rows are generated incrementally and encoded in chunks of at most 1,000 rows or about 256 KiB of text; an oversized row is encoded on its own. Export yields between chunks, prevents duplicate downloads during preparation, preserves the settled result during rechecks, and releases the object URL on download failures too. `README.md` documents continuous scanning and browser-memory limits. |

No pause/resume workflow or mandatory checkpoint was introduced. Internal batching, capacity waits and retries continue automatically; cancellation preserves the discovered report.

Deterministic fixtures cover a complete 200,000-record paginated stream generated one page at a time; count queries for 1,000 models; a cyclic 500-model schema graph; 500 owned blocks across 100 sparse locales and all five supported block levels; 10,000 asset references and 10,000 record relationships distributed over 100 records smaller than 100 KB each, proving those inventories are not crawled and supported URLs remain intact; a 4,096-URL skewed queue; a shared URL across 10,000 records and 200,000 occurrences; thousands of paged detail rows and warnings; 10,000 repeated lazy group updates; and chunked CSV fidelity. Faults include permanent permissions failures, retry exhaustion, 429 cooldowns, stalled response bodies, cancellation during reads/backoff/capacity waits, late responses, malformed records, duplicated pages and concurrent record deletion.

| Final check | Result | Evidence |
| --- | --- | --- |
| Complete test suite | Passed | `npm test -- --pool=threads --maxWorkers=1 --testTimeout=20000`: 30 files, 424 tests, 17.96 seconds. No file or test filters were used. |
| Lint | Passed | `npm run lint`: 94 files, no findings. |
| Typecheck and production build | Passed | `npm run lint && npm run build`: `tsc -b` and Vite passed. JavaScript 792.76 kB (248.75 kB gzip), CSS 64.30 kB (11.07 kB gzip). The existing advisory warning for a JavaScript chunk above 500 kB remains. |
| Targeted network checks | Passed | 121 checking tests and `tsc --noEmit -p tsconfig.app.json` passed before the final aggregate. |

The full suite used one worker and a 20-second per-test limit because other simultaneous plugin tasks initially saturated the shared host, causing worker-startup failures and wall-clock timeouts. The final successful run above executed every test. These timings describe the mock suite only. The nearest verification skill's aggregate lint/build/test commands were completed in this plugin. The repository-root `run-checks.js` was not run: its hard-coded plugin list excludes this package and its `npm i` would modify other plugin directories outside the authorized scope.

The current official references checked for this audit are [CMA record listing](https://www.datocms.com/docs/content-management-api/resources/item/instances) (30 records with nested blocks), [CMA pagination](https://www.datocms.com/docs/content-management-api/pagination) (count-only `limit: 0`), [CMA technical limits](https://www.datocms.com/docs/content-management-api/technical-limits) (60 requests per three seconds, 300 KB records, 500 owned blocks and five nested levels), [HTTP Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3), and [Fetch CORS response headers](https://fetch.spec.whatwg.org/#cors-safelisted-response-header-name). The plugin spaces its record/count request starts by 75 ms and still honors explicit API cooldowns; other clients can consume the same project quota.

Residual limits: the report, deduplication IDs and CSV file still need browser memory/storage proportional to their total contents. Combined model/locale/URL filters and detail-page discovery may scan occurrences; sorting remains proportional to the number of unique URLs. Counts and record reads are not a transaction, so concurrent changes can make totals approximate or coverage incomplete. The SDK's host-provided field-loading promises cannot be physically aborted by the plugin; canceled/late results are ignored and guarded by deadlines. Real proxy exposure of Retry-After through CORS and whether a 429 originated at the proxy or destination were not verified. Server waits longer than 30 seconds terminate an individual link check rather than retrying early; other URLs of that host can be explicitly marked Blocked/Unverified without a request during the waiting period. These outcomes never invent a destination HTTP status. The asset library and referenced records are not crawled: the plugin checks website links in supported record fields and owned blocks, not 10,000 asset downloads.

Synthetic tests establish correctness of these bounded paths, not production throughput, peak heap usage, maximum viable report size, host-iframe responsiveness or a successful scan of a real 200,000-record project. A current live pass remains unverified.

#### Redesigned UI (2026-09-28)

Recorded against the redesigned UI on 2026-09-28. These are automated checks only; the redesigned UI hasn't had a live DatoCMS pass yet (see below).

| Check | Result | Evidence |
| --- | --- | --- |
| Full test suite | Passed | `npm test`: 23 files, 293 tests. |
| Lint | Passed | `npm run lint`: 85 files, no findings. |
| Production build | Passed | `npm run build`: TypeScript and Vite passed. JavaScript is 776.47 kB (243.97 kB gzip) and CSS 64.30 kB (11.07 kB gzip); Vite reports its advisory 500 kB chunk-size warning. `dist/index.html` references its assets with relative `./assets/` paths. |
| Package inspection | Passed | `npm pack --dry-run`: 7 files (the entry point, its JavaScript and CSS, README, validation notes, MIT license and manifest). Only `currentUserAccessToken` is declared; no source, test files or source maps are shipped. |

#### Previous UI (2026-09-23)

Recorded before the redesign. These results describe the earlier UI and don't cover the current code.

| Check | Result | Evidence |
| --- | --- | --- |
| Full test suite | Passed | `npm test`: 13 files, 167 tests on 2026-09-23. |
| UI removal verification | Passed | Existing project, record and report UI suites: 19 tests passed after removing the help section. |
| Lint | Passed | `npm run lint`: 36 files, no findings. |
| Package inspection | Passed | Packed archive contains the declared entry point and referenced relative assets, README, validation notes, MIT license and manifest. Only `currentUserAccessToken` is declared; no source/test files, source maps, dependencies or environment files are shipped. |
| Production build | Passed | `npm run build`: TypeScript and Vite passed. JavaScript is 643.16 kB (198.23 kB gzip); Vite reports its advisory 500 kB chunk-size warning. |

## DatoCMS host validation

**Needs a new live pass for the redesigned UI.** The live checks recorded below were run against the previous UI, so none of them covers the current screens. Repeat those scenarios in a disposable sandbox with the redesigned UI, and also cover:

- Light and dark themes on the project page, the scope dialog, the record sidebar panel and the settings page.
- The Info sidebar in split mode and as an overlay in narrow frames. Opening and closing the overlay must leave the report behind it in place: same scroll position, same expanded coverage callout. Esc, the backdrop and the overlay's hide button close it; selecting the URL's text by dragging past the panel's edge doesn't. Focus moves into the overlay when it opens, Tab and Shift+Tab don't reach the report behind it, and focus goes back to the selected row when it closes. Narrowing the frame with the split sidebar open leaves the overlay closed and focus where it was.
- The scope dialog, including model and locale menus that grow the frame instead of opening in a portal, opened from the toolbar's **Choose what to scan…** (icon only, with its tooltip, in panes under 700px; hidden during a scan in panes under 560px, where the count is dropped too). The title should never truncate before the count.
- While a scan runs, the progress bar is the only loading indicator on the page: centered until a URL needs attention, then above the results. On a real project, check that the record count request succeeds (a percentage shows while records are read) and that the percentage roughly tracks the time the scan takes.
- The record panel's place rows with deep block paths and emoji in block names (for example "Content > 📲 CTA App Download > Google Play URL" in German): field first, path underneath, the whole row going to the field. With a long locale name (for example "Chinese (Traditional, Taiwan)") the locale moves under the field instead of squeezing it.
- Whether the record editor keeps form values for a locale removed from the record: the panel checks only the record's locales either way.
- The Link panel's external link opening the URL in a new tab from the plugin iframe.
- **Go to Link checker** on the settings page from a sandbox environment. Without the permission: the warning, no link to the page on the settings page, and no Link checker entry in the Content area.
- Column folding, and the toolbar and filter rows hiding their less important parts, in narrow report widths. Both depend on container queries that the automated tests don't exercise. A Model or Locale filter set in a wide frame must stay visible after the frame narrows, on a second filter line if needed.
- The pagination footer with the Info sidebar open in 1000–1200px frames, on reports with 100 or more pages.
- Picking a filter option with the arrow keys and Enter from the menu's search field, including options below the second one.
- Rechecking a URL while a status filter is on: the row stays in the table and reads "Checking" until the new result arrives, and the summary doesn't switch to "Nothing needs attention".
- Keyboard focus after starting, canceling or finishing a scan, which should land on the toolbar's new action, and after a recheck ends while focus is on a disabled toolbar control, which should stay on that control.
- With a screen reader: the record panel announcing the result when a check settles, and the scope dialog's model and locale selects announcing their names and "Field is required".
- The record sidebar panel's and the scope dialog's initial heights on single-locale and multi-locale projects: the frames shouldn't jump when they open.
- URLs in the record sidebar panel, the Info sidebar's Link panel and the Used in rows open in a new tab from inside the DatoCMS iframe, while clicking elsewhere on a Used in row still opens the record.
- Blocked and other explained results on real content, in the browser: the proxy's responses must be readable by the plugin for the checker to recognize them. A one-off Node run through the real proxy (with the dev server's localhost origin) on 2026-09-28 classified npm, Stack Overflow, Medium and G2 as Blocked, a made-up domain as Broken, an expired certificate as Unverified with its reason, and datocms.com, GitHub and a real 404 as before.

### Previous UI (2026-09-23)

The results in this section were recorded before the redesign and describe the earlier UI.

Live checks were run on **2026-09-23** in a disposable QA sandbox with a private development plugin inside the real DatoCMS host. The fixtures comprised two unpublished draft records, one article model, one block model and the `en` locale. No record was saved or published during the browser checks. Both surfaces were also scanned successfully using the final production bundle served with `vite preview`; the project status filter was verified using its native control.

| Scenario | Observed result | Coverage |
| --- | --- | --- |
| Install and open both surfaces | The project page and record sidebar rendered and completed scans inside DatoCMS. | Verified live. |
| Native appearance | Project scans and results were visually inspected in light and dark themes. Narrow sidebar results were inspected in both themes; Go to field was inspected in light. The original **Match system** preference, currently dark, was restored and read back. | Verified live in both themes for both surfaces. |
| Current saved versions | The project scan read both current draft records from the selected sandbox. | Verified live for draft-only fixtures. Published-versus-draft divergence was not run. |
| Scope selection | The fixture model and `en` locale were scanned. | Verified live for this scope. Multiple-model exclusions, other locales and empty scope are automated coverage only. |
| Supported content | Strings, plain text, Markdown, HTML anchors and Structured Text links were extracted from the live fixtures. The saved project scan checked two unique public destinations across two records. | Verified live. Markdown references, code exclusion and malformed-content variants are automated coverage only. |
| Nested/localized content | Modular Content, framed Single Block, Structured Text blocks and inline blocks were read. Independent extraction found six nested occurrences and no extraction warnings. | Verified live in `en` only. Frameless Single Block and multiple locales were not exercised live. |
| Excluded content | The live report showed one invalid destination and five skipped destinations, covering fixture examples such as relative paths, anchors, non-HTTP links, credential-bearing URLs and a loopback URL. | Verified live for these destination classes. Excluded field types and code are automated coverage only. |
| Unsaved/new record | An unsaved edit increased the sidebar scan to three unique checks and two broken destinations. A new record's URL was checked before its first save. Temporary edits were discarded. | Verified live; independent saved-record comparison confirmed no changes. |
| Missing or loading content | Automated fixtures cover missing schemas, unloaded content and serialization failures. | Automated only; no live failure was induced. |
| Read-only access | A temporary sandbox-only CMA token with a single record-read grant, no schema permission and no management capabilities ran the actual schema loader, record reader and extractor. It read both models and records, yielding 21 occurrences with zero warnings. A primary-environment read was denied with `401 INVALID_ENVIRONMENT`. | Verified against the live CMA. An interactive restricted collaborator session, field restrictions and locale restrictions were not run. |
| Missing API permission | The disabled state and actionable permission message are covered by UI tests. | Automated only. |
| Native record dialog | Opening and dismissing the native editor retained the project report. No Save action was used. | Verified live for open/dismiss. Marking results stale after a dialog save is automated coverage only. |
| Field navigation and stale edits | Go to field navigated to a source field. Editing form content showed the stale-results banner. | Verified live in `en`. Navigation to absent/removed locales is automated coverage only. |
| Live HTTP result classification | A public successful destination and a deliberately missing public page were checked. The project report identified the missing page as broken with HTTP 404 and six occurrences. | Verified live for success and 404. HTTP 410, timeouts, other error statuses and controlled HEAD rejection use mocked tests only. |
| Redirects and fragments | Fragment-only fixture destinations were skipped. | Verified live for fragment-only skipping. Redirect behavior and normalization variants are automated coverage only; no anchor validation is claimed. |
| Cancel and recheck | A live recheck was canceled and the report remained available. | Verified live for that interaction, which predates the redesigned UI: the current UI has no way to cancel a recheck. Cancellation during schema discovery and the full stale/incomplete recheck matrix are automated coverage only. |
| Session lifetime | Leaving or reloading the plugin view cleared the report. | Verified live. Environment/user switching and late-callback isolation are automated coverage only. |
| Concurrent changes and pagination | Live scanning exposed the CMA's nested-record page limit of 30, which the reader now uses. The fixture scan contained two records. | Live page-limit correction verified. Multiple pages and concurrent record changes are automated coverage only. |
| CSV download | Export produced an actual downloaded CSV file, which was verified. | Verified live for browser download. CSV escaping, formula protection and stale/incomplete combinations are automated coverage only. |

#### Independent preservation checks

After the browser scenarios, both full nested record responses exactly matched their setup snapshots, including their record versions and draft status. The primary environment remained primary, and its site settings, models, plugins and records matched the pre-setup snapshots.

The restricted-access check created a temporary role and CMA token, performed reads only with that token, and removed both resources in a `finally` cleanup. The role and token inventories matched their original identifiers afterward. No collaborators were invited or reassigned. Credential values were kept in memory and excluded from validation artifacts.

## Remaining limits

The report does not include redirect chains or final destination URLs. Reachability does not validate anchors, page semantics, login requirements or soft 404s. A project scan is a sequence of reads, not a transactionally consistent snapshot. Record these as product limits rather than successful validations.
