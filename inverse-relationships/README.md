# DatoCMS Inverse Relationships

A simple plugin that displays inverse relationships in a record's sidebar (ie. blog posts by a specific author).

## Configuration

In the plugin settings, specify the model whose records should be listed, plus the single-link or multiple-links field that connects them back to the current record. You can also configure the ordering and the maximum number of results to display. A read-only DatoCMS API token can optionally be provided; otherwise the plugin uses the editor's current access token.

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/inverse-relationships/docs/global.png)

Once configured, an "Inverse relationships" panel will automatically appear in the sidebar of every record, listing the matching linked records with quick links to open them.

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/inverse-relationships/docs/instance.png)

## Changelog

- 0.1.11 - Declared `"permissions": ["currentUserAccessToken"]` in the plugin manifest so `ctx.currentUserAccessToken` is actually populated at runtime. Without it, the optional zero-config flow added in 0.1.10 always fell back to an empty token because the SDK leaves `currentUserAccessToken` `undefined` when the permission isn't requested.
- 0.1.10 - Fixed the plugin being effectively unconfigurable, which made the inverse-relationships sidebar panel never appear. The required `itemTypeApiKey`, `fieldApiKey`, `orderBy`, and `limit` parameters were declared as `instance` parameters (per-field) but the runtime read them from `ctx.plugin.attributes.parameters` (global) and the plugin no longer registers any field extension to attach them to. Promoted them to `global` parameters so the built-in plugin settings UI exposes them. The `datoCmsApiToken` is now optional — the SidebarPanel already falls back to `ctx.currentUserAccessToken` — and its hint no longer points to the broken `/admin/access_tokens` link. Also added `base: './'` to the Vite config so the bundled `index.html` references its assets relatively, matching the other plugins in this repo.
