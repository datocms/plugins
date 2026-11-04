<!--datocms-autoinclude-header start-->

<a href="https://www.datocms.com/"><img src="https://www.datocms.com/images/full_logo.svg" height="60"></a>

👉 [Visit the DatoCMS homepage](https://www.datocms.com) or see [What is DatoCMS?](#what-is-datocms)

---

<!--datocms-autoinclude-header end-->

# DatoCMS plugins repository

This repository provides examples of real DatoCMS plugins developed using the official [DatoCMS Plugins SDK](https://www.datocms.com/docs/plugin-sdk/introduction).

### Plugins

- [AI Asset Source](https://github.com/datocms/plugins/blob/master/ai-asset-source/README.md): Media Area asset source that generates images from a prompt with OpenAI or Google models and uploads the ones you pick.
- [AI Translations](https://github.com/datocms/plugins/blob/master/ai-translations/README.md): Translate field values, entire records, and full bulk batches using DeepL, OpenAI, Anthropic, or Yandex.
- [All Records Viewer](https://github.com/datocms/plugins/blob/master/all-records-viewer/README.md): One paginated table of records from every model, with search, filters, and bulk publish, unpublish, delete, or move to a workflow stage.
- [Alt Text AI](https://github.com/datocms/plugins/blob/master/alt-text-ai/README.md): Generate alt text for images from file and gallery fields or the Media Area, using AltText.ai, OpenAI, Anthropic Claude, or Google Gemini.
- [Asset Localization Checker](https://github.com/datocms/plugins/blob/master/asset-localization-checker/README.md): Field add-on, auto-attached to single-asset fields, that flags which locales are missing alt or title text (asset defaults and field overrides).
- [Asset Optimization](https://github.com/datocms/plugins/blob/master/asset-optimization/README.md): Bulk-optimize every project upload through Imgix transformations (format, max width, quality, lossless, etc.) with a preview-only dry run.
- [Automatic Environment Backups](https://github.com/datocms/plugins/blob/master/automatic-environment-backups/README.md): Rotating daily, weekly, bi-weekly, or monthly backups of your primary environment as sandbox forks, run by a scheduler you deploy to Vercel, Netlify, or Cloudflare.
- [Block to Links](https://github.com/datocms/plugins/blob/master/block-to-links/README.md): Convert a block model into a regular model, migrating every block instance into a record and turning the fields that embedded it into links.
- [Broken Link Checker](https://github.com/datocms/plugins/blob/master/broken-link-checker/README.md): Scan the whole project for broken links (with CSV export), or check a single record, unsaved changes included, from its sidebar.
- [Bulk Change Author](https://github.com/datocms/plugins/blob/master/bulk-change-author/README.md): Bulk action that reassigns the creator on every selected record from the collection view.
- [Centra](https://github.com/datocms/plugins/blob/master/centra/README.md): Pick Centra products, variants, and SKU/size items in a JSON field, storing stable IDs and showing live catalog data.
- [Character Counter](https://github.com/datocms/plugins/blob/master/character-counter/README.md): Auto-attaches to any field with a length validator and shows live character, word, and readability stats.
- [Conditional Fields](https://github.com/datocms/plugins/blob/master/conditional-fields/README.md): Show or hide one or more target fields based on the value of a boolean source field, with optional inversion.
- [Content Calendar](https://github.com/datocms/plugins/blob/master/content-calendar/README.md): Calendar view of records (publish date, schedule, last-updated, creation date) inside the DatoCMS dashboard.
- [Copy Links](https://github.com/datocms/plugins/blob/master/copy-links/README.md): Copy and paste linked records between single-link and multiple-links fields without leaving the record editor.
- [Dato Agent (Beta)](https://github.com/datocms/plugins/blob/master/dato-agent/README.md): Natural-language agent (OpenAI or Anthropic) that explains the project, finds and opens records, and prepares content changes for approval via the DatoCMS MCP server.
- [Delete Asset from Other Environments](https://github.com/datocms/plugins/blob/master/delete-asset-from-other-environments/README.md): Special-purpose upload sidebar panel that deletes an asset's unused copies in every other environment, so it can be fully evicted from the CDN.
- [Delete Assets Option](https://github.com/datocms/plugins/blob/master/delete-assets-option/README.md): When deleting records, prompt the editor to also delete the assets they referenced.
- [Delete Unused Assets](https://github.com/datocms/plugins/blob/master/delete-unused-assets/README.md): Scan for uploads no record uses, review the list, and delete the ones you select.
- [Disabled Field](https://github.com/datocms/plugins/blob/master/disabled-field/README.md): Field add-on that disables any field, turning it into a read-only display in the record editor.
- [Find and Replace](https://github.com/datocms/plugins/blob/master/find-and-replace/README.md): Search every text field across the project's records, preview each replacement, and apply and publish the ones you keep.
- [Scroll to Field](https://github.com/datocms/plugins/blob/master/field-anchor-menu/README.md): (Formerly Field Anchor Menu) Sidebar table of contents that lists every field in the record form and scrolls to them on click.
- [Schema Import/Export](https://github.com/datocms/plugins/blob/master/import-export-schema/README.md): Export models and blocks (plus the plugins their fields use) as JSON and import them into another project or environment, resolving each conflict before anything is created.
- [Inverse Relationships](https://github.com/datocms/plugins/blob/master/inverse-relationships/README.md): Sidebar panel that lists every record linking back to the current one (e.g., posts by an author).
- [Locale Duplicate](https://github.com/datocms/plugins/blob/master/locale-duplicate/README.md): Copy content between locales — at the field level on a single record, or across many records and models at once.
- [Lorem Ipsum Generator](https://github.com/datocms/plugins/blob/master/lorem-ipsum/README.md): Field dropdown action that generates dummy text tuned to the field's editor (string, Markdown, WYSIWYG, Structured Text).
- [Media Layouts](https://github.com/datocms/plugins/blob/master/media-layouts/README.md): Visual gallery and layout builder for collections of media, stored as JSON (single, multiple, or grid/masonry layouts).
- [Notes](https://github.com/datocms/plugins/blob/master/notes/README.md): Post-it style sticky notes for editors, attached to a JSON sidebar field on configured models.
- [Project Exporter](https://github.com/datocms/plugins/blob/master/project-exporter/README.md): Export an environment as a DatoCMS CLI-compatible project dump, or records as JSON, CSV, XML, or XLSX and assets as a ZIP, from the browser.
- [Workflow Stage View](https://github.com/datocms/plugins/blob/master/project-wide-stage-viewer/README.md): Cross-model table of every record in a workflow stage, pinned to the content sidebar, with bulk publish, unpublish, delete, and move.
- [Prompt Dato](https://github.com/datocms/plugins/blob/master/prompt-dato/README.md): AI chat sidebar in the record editor (OpenAI, Anthropic, or Google) that carries out project operations through the hosted DatoCMS MCP server.
- [Record Auto-save](https://github.com/datocms/plugins/blob/master/record-auto-save/README.md): Periodically auto-save the record being edited on configured models, with optional debounce and notifications.
- [Record Bin](https://github.com/datocms/plugins/blob/master/record-bin/README.md): Keeps a restorable copy of every deleted record in a "Record Bin" model, with an optional serverless function to also catch API deletions.
- [Record Comments](https://github.com/datocms/plugins/blob/master/record-comments/README.md): Leave threaded comments under a record so collaborators can discuss content in place, with optional realtime updates.
- [Rich Text TinyMCE](https://github.com/datocms/plugins/blob/master/rich-text-tinymce/README.md): TinyMCE-powered rich-text editor for multi-paragraph (`text`) fields.
- [Schema ERD](https://github.com/datocms/plugins/blob/master/schema-erd/README.md): Visualize the project schema as a Graphviz ER diagram and export it as SVG or DOT.
- [SEO Readability Analysis](https://github.com/datocms/plugins/blob/master/seo-readability-analysis/README.md): Runs YoastSEO.js SEO and readability analysis against your live frontend on every record edit.
- [Shopify Product](https://github.com/datocms/plugins/blob/master/shopify-product/README.md): Pick Shopify products, variants, or collections in a string or JSON field, storing a stable reference your frontend resolves live.
- [Slug Redirects](https://github.com/datocms/plugins/blob/master/slug-redirects/README.md): Automatically log slug changes to a singleton model so your frontend can serve 301 redirects from old URLs.
- [Star Rating Editor](https://github.com/datocms/plugins/blob/master/star-rating-editor/README.md): Render integer fields as configurable star-rating widgets.
- [Table Editor](https://github.com/datocms/plugins/blob/master/table-editor/README.md): Transform any JSON field into a structured table editor with named columns and rows.
- [Tag Editor](https://github.com/datocms/plugins/blob/master/tag-editor/README.md): Transform any string or JSON field into a tag/chip editor with auto-apply rules.
- [Tile Picker](https://github.com/datocms/plugins/blob/master/tile-picker/README.md): Replace a string field with a visual grid or carousel of color swatches and image tiles, with reusable global presets.
- [Todo List](https://github.com/datocms/plugins/blob/master/todo-list/README.md): JSON-field-backed todo list editor — add tasks, mark complete, reorder, hide/show completed.
- [Tree-like Slugs](https://github.com/datocms/plugins/blob/master/tree-like-slugs/README.md): Slug field add-on that propagates parent slug changes to all descendant records.
- [Unsplash](https://github.com/datocms/plugins/blob/master/unsplash/README.md): Asset source that imports Unsplash images (with author and credit metadata) directly into Media.
- [Web Previews](https://github.com/datocms/plugins/blob/master/web-previews/README.md): Preview links and an inline iframe preview in the record sidebar, plus a full-screen Visual tab with click-to-edit overlays, across multiple frontends.
- [Yandex Translate](https://github.com/datocms/plugins/blob/master/yandex-translate/README.md): Translate fields via Yandex Translate, manually from a dropdown or via auto-apply rules on field API keys.
- [Zoned Datetime Picker](https://github.com/datocms/plugins/blob/master/zoned-datetime-picker/README.md): Datetime picker with an explicit IANA timezone selection, stored as a structured JSON field.

<!--datocms-autoinclude-footer start-->

---

# What is DatoCMS?

<a href="https://www.datocms.com/"><img src="https://www.datocms.com/images/full_logo.svg" height="60" alt="DatoCMS - The Headless CMS for the Modern Web"></a>

[DatoCMS](https://www.datocms.com/) is Headless CMS for the modern web. Trusted by 25,000+ businesses, agencies, and individuals, it gives your team one place to manage content and ship it to any website, app, or device via API.

**New here?** Start with [Create free account](https://dashboard.datocms.com/signup) and the [Documentation](https://www.datocms.com/docs). Stuck? Ask the [Community](https://community.datocms.com/). Curious what's new? [Product Updates](https://www.datocms.com/product-updates).

**Building with AI:** [Agent Skills](https://www.datocms.com/docs/agent-skills) turn coding assistants (Claude Code, Cursor) into expert DatoCMS developers, with full read/write via the auto-installed CLI. No local terminal? Use the [MCP Server](https://www.datocms.com/docs/mcp-server) instead.

**Talking to DatoCMS from code:**
- [Content Delivery API](https://www.datocms.com/docs/content-delivery-api) (CDA) — the fast, read-only GraphQL API your website/app uses to **fetch** published content.
- [Content Management API](https://www.datocms.com/docs/content-management-api) (CMA) — the REST API for **creating and updating** content, models, and project settings (think scripts, migrations, integrations).
- [CLI](https://www.datocms.com/docs/scripting-migrations/installing-the-cli) — terminal tool for schema migrations and importing from Contentful/WordPress.

**Framework guides:** end-to-end recipes for fetching content, rendering Structured Text, optimizing images/video, handling SEO, and setting up live preview with visual editing in [Next.js](https://www.datocms.com/docs/next-js), [Nuxt](https://www.datocms.com/docs/nuxt), [Svelte](https://www.datocms.com/docs/svelte), and [Astro](https://www.datocms.com/docs/astro).

**Want a head start?** Browse our [starter projects](https://www.datocms.com/marketplace/starters) — ready-to-deploy example sites for popular frameworks.


<!--datocms-autoinclude-footer end-->
