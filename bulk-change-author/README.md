# Bulk Change Author for DatoCMS

Give editors a fast, safe way to transfer ownership of many records at once. The **Bulk Change Author** plugin adds a bulk dropdown action to DatoCMS collection (table) views that lets you pick a collaborator, SSO user, or project owner and reassign the `creator` metadata across multiple selected entries in just a few clicks.

---

## Why use this plugin?

- **Speed up editorial workflows:** Update dozens (or hundreds) of items without manual edits or API scripts.
- **Stay permission-aware:** Uses the current editor's access token, so DatoCMS enforces "Edit creator" permissions automatically.
- **Consistent UX:** Leverages Dato's native dropdown action menu and modal styling so the feature feels built-in.
- **Error visibility:** Summarizes successes and per-record failures, making it clear when additional permissions or retries are needed.

---

## Features at a glance

- Registers an **items dropdown action** labelled "Change creators…" in the collection (table) view, available when one or more records are selected.
- Opens a modal that fetches collaborators, SSO users, and the project owner (`users.list()` + `ssoUsers.list()` + `site.find()`), letting the editor pick the new creator from a combined, grouped list.
- Performs individual record updates with up to 6 workers and a shared limit of 10 request starts per second, including retries and confirmation reads.
- Displays post-action notices/alerts, including individual failure messages for items that could not be updated.
- Works in the active environment (primary or sandbox) thanks to `ctx.environment`.
- Requires the `currentUserAccessToken` permission to be granted to the plugin.

> Note: the action only appears in the **collection / table view dropdown** when records are selected. It is not currently exposed in the individual record's edit page dropdown.

---

## Installation

1. Clone or download this repository.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start the dev server:

   ```bash
   pnpm dev
   ```

4. In your DatoCMS project, go to **Settings → Plugins → Add new plugin → Create a new plugin**.
5. Paste the local dev server URL (default `http://localhost:5173`) in the manual plugin URL field.
   When you're ready to ship, run `pnpm build` and upload the contents of the `dist/` folder to DatoCMS or host them on a CDN.

---

## Usage

1. Open the collection (table) view for any model.
2. Tick the records you want to update.
3. From the bulk actions dropdown, choose **Change creators…**.
4. In the modal, pick the collaborator, SSO user, or project owner who should become the new creator.
5. Confirm; the plugin updates all selected items and reports any failures.

For selections of 500 or more records, the same modal shows continuous progress and a **Stop** button. Stop prevents further requests, including confirmation reads waiting on a rate limit, and waits for requests already started to finish. Updates whose responses were lost and could not be confirmed are reported as uncertain. Execution continues automatically through temporary rate limits; no manual pause or continuation is required. Keep the browser window open until completion.

## Large selections and failure handling

- Only the selected IDs and a deduplication set are retained by the runner. Successful results use counters; at most five sanitized failure samples are kept. The plugin does not load models, assets, locales, references, or nested content before updating creator metadata. Raw CMA responses avoid recursively deserializing record content that the runner does not use.
- DatoCMS preserves omitted fields in [record updates](https://www.datocms.com/docs/content-management-api/resources/item/update). The request changes only the `creator` relationship; it does not publish records or rewrite their content.
- The CMA permits [60 requests per 3 seconds](https://www.datocms.com/docs/content-management-api/technical-limits). There is no bulk creator-update endpoint. At this plugin's 10 requests/second, 200,000 updates require **at least approximately 5 hours 33 minutes**, and may take longer because of latency, other API clients, or retries.
- Rejected requests marked transient or rate-limited are retried automatically up to five attempts, with a shared cooldown, exponential backoff, jitter, and support for `Retry-After` and `X-RateLimit-Reset`.
- A response lost through timeout, network failure, invalid response, or server error is ambiguous. The plugin checks the current creator via bounded read requests. It never automatically resends that ambiguous update, since another PUT could create extra versions or webhooks. If confirmation fails, the affected record is reported separately as uncertain and further scheduling stops.
- Record-specific permission, validation, or missing-record failures do not stop other records. Authentication failure or exhausted transient retries stop further scheduling. Final feedback separates successes, definite failures, uncertain outcomes, and records not started.
- Collaborator and SSO user endpoints return complete, unpaginated lists. A warning identifies partial availability if one of those lists cannot be loaded.

The dashboard SDK supplies the selected records as a complete `Item[]` before this plugin runs. Its ability to materialize and transfer 200,000 complex records cannot be improved inside this plugin. Browser navigation, sleep, closure, expired credentials, or other editors changing creators can interrupt or affect a long execution. This plugin does not provide a background server job or cross-record transaction.

The installed CMA SDK leaves its outer 35-second timeout timer pending when fetch rejects. The plugin's own fetch deadline is cleaned up and no automatic mutation retry occurs; a deterministic test verifies that the remaining SDK timer expires without dispatching another request.

These limits and behaviors are verified by mocks and official API contracts. They do not prove production throughput, browser memory use for the dashboard selection, or end-to-end completion of a live 200,000-record job.

> Tip: If you see "403 Forbidden" errors, make sure your role grants "Edit creator" permission for the relevant models.

---

## Development notes

- **Tech stack:** React 18, Vite, TypeScript, `datocms-plugin-sdk`, `datocms-react-ui`, and the browser-ready `@datocms/cma-client-browser`.
- **Key entry points:**
    - `src/main.tsx` – registers the `itemsDropdownActions`, executes the modal, and handles result notices.
    - `src/entrypoints/SelectCreatorModal.tsx` – modal UI and collaborator loading logic.
    - `src/actions/bulkChangeCreator.ts` – concurrency-limited CMA updates.
- **Environment awareness:** The CMA client respects the current environment via `ctx.environment`.
- **Validation:** `npm run check` runs lint, deterministic Vitest tests, TypeScript, and the production build. `npm run typecheck` is also available separately. Tests use synthetic IDs, mocked CMA/fetch, and fake clocks; they never contact a DatoCMS project.

---

## Roadmap ideas

- Remember the last selected collaborator per editor session.
- Allow filtering by role before rendering the dropdown options.


Contributions and suggestions are welcome—feel free to open issues or PRs. If you use this plugin in production, we'd love to hear your feedback!
