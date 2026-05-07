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

[DatoCMS](https://www.datocms.com/) is the REST & GraphQL Headless CMS for the modern web.

Trusted by over 25,000 enterprise businesses, agencies, and individuals across the world, DatoCMS users create online content at scale from a central hub and distribute it via API. We ❤️ our [developers](https://www.datocms.com/team/best-cms-for-developers), [content editors](https://www.datocms.com/team/content-creators) and [marketers](https://www.datocms.com/team/cms-digital-marketing)!

**Why DatoCMS?**

- **API-First Architecture**: Built for both REST and GraphQL, enabling flexible content delivery
- **Just Enough Features**: We believe in keeping things simple, and giving you [the right feature-set tools](https://www.datocms.com/features) to get the job done
- **Developer Experience**: First-class TypeScript support with powerful developer tools

**Getting Started:**

- ⚡️ [Create Free Account](https://dashboard.datocms.com/signup) - Get started with DatoCMS in minutes
- 🔖 [Documentation](https://www.datocms.com/docs) - Comprehensive guides and API references
- ⚙️ [Community Support](https://community.datocms.com/) - Get help from our team and community
- 🆕 [Changelog](https://www.datocms.com/product-updates) - Latest features and improvements

**Official Libraries:**

- [**Content Delivery Client**](https://github.com/datocms/cda-client) - TypeScript GraphQL client for content fetching
- [**REST API Clients**](https://github.com/datocms/js-rest-api-clients) - Node.js/Browser clients for content management
- [**CLI Tools**](https://github.com/datocms/cli) - Command-line utilities for schema migrations (includes [Contentful](https://github.com/datocms/cli/tree/main/packages/cli-plugin-contentful) and [WordPress](https://github.com/datocms/cli/tree/main/packages/cli-plugin-wordpress) importers)

**Official Framework Integrations**

Helpers to manage SEO, images, video and Structured Text coming from your DatoCMS projects:

- [**React Components**](https://github.com/datocms/react-datocms)
- [**Vue Components**](https://github.com/datocms/vue-datocms)
- [**Svelte Components**](https://github.com/datocms/datocms-svelte)
- [**Astro Components**](https://github.com/datocms/astro-datocms)

**Additional Resources:**

- [**Plugin Examples**](https://github.com/datocms/plugins) - Example plugins we've made that extend the editor/admin dashboard
- [**Starter Projects**](https://www.datocms.com/marketplace/starters) - Example website implementations for popular frameworks
- [**All Public Repositories**](https://github.com/orgs/datocms/repositories?q=&type=public&language=&sort=stargazers)

<!--datocms-autoinclude-footer end-->
