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
