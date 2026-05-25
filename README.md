<!--datocms-autoinclude-header start-->

<a href="https://www.datocms.com/"><img src="https://www.datocms.com/images/full_logo.svg" height="60"></a>

👉 [Visit the DatoCMS homepage](https://www.datocms.com) or see [What is DatoCMS?](#what-is-datocms)

---

<!--datocms-autoinclude-header end-->

# DatoCMS plugins repository

This repository provides examples of real DatoCMS plugins developed using the official [DatoCMS Plugins SDK](https://www.datocms.com/docs/plugin-sdk/introduction).

### Plugins

- [AI Asset Source](https://github.com/datocms/plugins/blob/master/ai-asset-source/README.md): Generate images from a prompt (OpenAI or Google providers) and add them directly as project uploads.
- [AI Translations](https://github.com/datocms/plugins/blob/master/ai-translations/README.md): Translate field values, entire records, and full bulk batches using DeepL, OpenAI, Anthropic, or Yandex.
- [Alt Text AI](https://github.com/datocms/plugins/blob/master/alt-text-ai/README.md): Generate alt text for image uploads in a single click via the AltText.ai service.
- [Asset Localization Checker](https://github.com/datocms/plugins/blob/master/asset-localization-checker/README.md): Sidebar panel that flags which locales of a single-asset field are missing alt or title metadata.
- [Asset Optimization](https://github.com/datocms/plugins/blob/master/asset-optimization/README.md): Bulk-optimize every project upload through Imgix transformations (format, max width, quality, lossless, etc.) with a preview-only dry run.
- [Automatic Environment Backups](https://github.com/datocms/plugins/blob/master/automatic-environment-backups/README.md): Schedule automatic forks of your primary environment (daily, weekly, biweekly, or monthly) as off-site backups.
- [Block to Links](https://github.com/datocms/plugins/blob/master/block-to-links/README.md): Convert legacy embedded modular-content blocks into linked records on a chosen model.
- [Bulk Change Author](https://github.com/datocms/plugins/blob/master/bulk-change-author/README.md): Bulk action that reassigns the creator on every selected record from the collection view.
- [Character Counter](https://github.com/datocms/plugins/blob/master/character-counter/README.md): Auto-attaches to any field with a length validator and shows live character, word, and readability stats.
- [Conditional Fields](https://github.com/datocms/plugins/blob/master/conditional-fields/README.md): Show or hide one or more target fields based on the value of a boolean source field, with optional inversion.
- [Content Calendar](https://github.com/datocms/plugins/blob/master/content-calendar/README.md): Calendar view of records (publish date, schedule, last-updated, creation date) inside the DatoCMS dashboard.
- [Copy Links](https://github.com/datocms/plugins/blob/master/copy-links/README.md): Copy and paste linked records between single-link and multiple-links fields without leaving the record editor.
- [Delete Asset from Other Environments](https://github.com/datocms/plugins/blob/master/delete-asset-from-other-environments/README.md): For an unused upload, bulk-delete its copies across every other environment so CDN caches evict cleanly.
- [Delete Assets Option](https://github.com/datocms/plugins/blob/master/delete-assets-option/README.md): When deleting records, prompt the editor to also delete the assets they referenced.
- [Delete Unused Assets](https://github.com/datocms/plugins/blob/master/delete-unused-assets/README.md): One-click cleanup that bulk-deletes every project upload not referenced anywhere.
- [Disabled Field](https://github.com/datocms/plugins/blob/master/disabled-field/README.md): Field add-on that disables any field, turning it into a read-only display in the record editor.
- [Scroll to Field](https://github.com/datocms/plugins/blob/master/field-anchor-menu/README.md): (Formerly Field Anchor Menu) Sidebar table of contents that lists every field in the record form and scrolls to them on click.
- [Import/Export Schema](https://github.com/datocms/plugins/blob/master/import-export-schema/README.md): Export and import project schema (models, blocks, fields, validators) as a portable JSON document, with conflict diffing.
- [Inverse Relationships](https://github.com/datocms/plugins/blob/master/inverse-relationships/README.md): Sidebar panel that lists every record linking back to the current one (e.g., posts by an author).
- [Locale Duplicate](https://github.com/datocms/plugins/blob/master/locale-duplicate/README.md): Bulk-copy content between locales — at the field level on a single record, or across many records and models at once.
- [Lorem Ipsum Generator](https://github.com/datocms/plugins/blob/master/lorem-ipsum/README.md): Field dropdown action that generates dummy text tuned to the field's editor (string, Markdown, WYSIWYG, Structured Text).
- [Media Layouts](https://github.com/datocms/plugins/blob/master/media-layouts/README.md): Visual gallery and layout builder for collections of media, stored as JSON (single, multiple, or grid/masonry layouts).
- [Notes](https://github.com/datocms/plugins/blob/master/notes/README.md): Post-it style sticky notes for editors, attached to a JSON sidebar field on configured models.
- [Project Exporter](https://github.com/datocms/plugins/blob/master/project-exporter/README.md): Export every record (and its referenced assets) of a project as a downloadable JSON manifest plus chunked asset ZIPs.
- [Project-wide Stage Viewer](https://github.com/datocms/plugins/blob/master/project-wide-stage-viewer/README.md): Cross-model view of every record currently sitting in a given workflow stage, surfaced from the content sidebar.
- [Record Auto-save](https://github.com/datocms/plugins/blob/master/record-auto-save/README.md): Periodically auto-save the record being edited on configured models, with optional debounce and notifications.
- [Record Bin](https://github.com/datocms/plugins/blob/master/record-bin/README.md): Soft-delete and restore "trash bin" for records, with an optional Lambda runtime for long-term storage.
- [Record Comments](https://github.com/datocms/plugins/blob/master/record-comments/README.md): Leave threaded comments under a record so collaborators can discuss content in place, with optional realtime updates.
- [Rich Text TinyMCE](https://github.com/datocms/plugins/blob/master/rich-text-tinymce/README.md): TinyMCE-powered rich-text editor for multi-paragraph (`text`) fields.
- [Schema ERD](https://github.com/datocms/plugins/blob/master/schema-erd/README.md): Visualize the project schema as a Graphviz ER diagram and export it as SVG or DOT.
- [SEO Readability Analysis](https://github.com/datocms/plugins/blob/master/seo-readability-analysis/README.md): Runs YoastSEO.js SEO and readability analysis against your live frontend on every record edit.
- [Shopify Product](https://github.com/datocms/plugins/blob/master/shopify-product/README.md): Search Shopify products and embed selected ones into a string or JSON field.
- [Slug Redirects](https://github.com/datocms/plugins/blob/master/slug-redirects/README.md): Automatically log slug changes to a singleton model so your frontend can serve 301 redirects from old URLs.
- [Star Rating Editor](https://github.com/datocms/plugins/blob/master/star-rating-editor/README.md): Render integer fields as configurable star-rating widgets.
- [Table Editor](https://github.com/datocms/plugins/blob/master/table-editor/README.md): Transform any JSON field into a structured table editor with named columns and rows.
- [Tag Editor](https://github.com/datocms/plugins/blob/master/tag-editor/README.md): Transform any string or JSON field into a tag/chip editor with auto-apply rules.
- [Todo List](https://github.com/datocms/plugins/blob/master/todo-list/README.md): JSON-field-backed todo list editor — add tasks, mark complete, reorder, hide/show completed.
- [Tree-like Slugs](https://github.com/datocms/plugins/blob/master/tree-like-slugs/README.md): Slug field add-on that propagates parent slug changes to all descendant records.
- [Unsplash](https://github.com/datocms/plugins/blob/master/unsplash/README.md): Asset source that imports Unsplash images (with author and credit metadata) directly into Media.
- [Web Previews](https://github.com/datocms/plugins/blob/master/web-previews/README.md): Show frontend preview links on selected records and surface a full in-CMS visual editor (Visual tab and sidebar).
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
