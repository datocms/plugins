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
- Performs bulk `items.update()` calls with gentle concurrency limits (default 6 in flight) to respect rate limits.
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

> Tip: If you see "403 Forbidden" errors, make sure your role grants "Edit creator" permission for the relevant models.

---

## Development notes

- **Tech stack:** React 18, Vite, TypeScript, `datocms-plugin-sdk`, `datocms-react-ui`, and the browser-ready `@datocms/cma-client-browser`.
- **Key entry points:**
    - `src/main.tsx` – registers the `itemsDropdownActions`, executes the modal, and handles result notices.
    - `src/entrypoints/SelectCreatorModal.tsx` – modal UI and collaborator loading logic.
    - `src/actions/bulkChangeCreator.ts` – concurrency-limited CMA updates.
- **Environment awareness:** The CMA client respects the current environment via `ctx.environment`.

---

## Roadmap ideas

- Remember the last selected collaborator per editor session.
- Allow filtering by role before rendering the dropdown options.


Contributions and suggestions are welcome—feel free to open issues or PRs. If you use this plugin in production, we'd love to hear your feedback!
