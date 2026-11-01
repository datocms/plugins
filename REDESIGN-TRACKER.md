# New design tracker

Branch `new-design-do-not-publish` rebuilds the UI of every plugin from scratch on the DatoCMS design language (`datocms-react-ui@next`, 3.x, with `datocms-plugin-sdk@next`). Nothing on this branch gets published or released.

The rules for every plugin:

- Every surface the plugin draws in a frame is designed again from the design-language patterns and components, not re-skinned.
- Features, stored parameters and public IDs stay compatible with the released version.
- `npm run build`, plus `lint` and `test` where the plugin defines them, pass.

Status: Pending, In progress, Done, or Needs attention.

| # | Plugin | UI code (lines) | React → target | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | dato-agent | 20107 | ^19.2.7 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 2 | shopify-product | 12006 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 3 | record-comments | 9491 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 4 | ai-translations | 9239 | ^19.2.7 | Done | On 3.1.0-next.1 and the updated skill. Sidebar panel, config, picker, confirm and progress dialogs, and bulk page rebuilt; checked headless in light and dark. Build, lint and 980 tests pass. The help popover of the bulk page is cut off in frames under about 590px wide and its ARIA attributes are off; both need a fix in datocms-react-ui. |
| 5 | import-export-schema | 7122 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. 1 minor issue open. |
| 6 | media-layouts | 6900 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 7 | broken-link-checker | 6569 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 8 | prompt-dato | 6025 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint none, tests none. No open issues. |
| 9 | find-and-replace | 5803 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 10 | web-previews | 4002 | ^18.3.1 | Done | On 3.1.0-next.1 and the updated skill. Config, sidebar preview, record panel, Visual tab and setup guide rebuilt; checked headless in light and dark. Build, typecheck and biome pass (no tests). The icon is picked inline in its cell instead of in the old dialog. 3 minor issues open. |
| 11 | all-records-viewer | 3919 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 12 | project-wide-stage-viewer | 3864 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 13 | centra | 3619 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 14 | asset-optimization | 3050 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 15 | locale-duplicate | 2841 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 16 | ai-asset-source | 2203 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 17 | record-bin | 2048 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 18 | automatic-environment-backups | 1785 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint none, tests pass. No open issues. |
| 19 | block-to-links | 1422 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint none, tests pass. No open issues. |
| 20 | seo-readability-analysis | 1355 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, no lint script, no tests. No open issues. |
| 21 | delete-unused-assets | 1325 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 22 | table-editor | 1148 | ^17.0.2 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 23 | tile-picker | 1110 | ^18.3.1 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint none, tests none. No open issues. |
| 24 | bulk-change-author | 974 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 25 | project-exporter | 797 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint none, tests pass. No open issues. |
| 26 | content-calendar | 768 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 27 | alt-text-ai | 713 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 28 | unsplash | 633 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 29 | zoned-datetime-picker | 565 | ^19.2.7 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 30 | star-rating-editor | 511 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 31 | tag-editor | 510 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 32 | delete-asset-from-other-environments | 467 | ^18.3.1 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 33 | character-counter | 448 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 34 | yandex-translate | 424 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 35 | schema-erd | 401 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 36 | asset-localization-checker | 381 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 37 | inverse-relationships | 365 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 38 | conditional-fields | 349 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 39 | field-anchor-menu | 343 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 40 | record-auto-save | 338 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 41 | rich-text-tinymce | 332 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 42 | todo-list | 326 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 43 | lorem-ipsum | 316 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 44 | notes | 314 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 45 | slug-redirects | 263 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, no lint script, no test files. No open issues. |
| 46 | tree-like-slugs | 204 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 47 | delete-assets-option | 131 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests pass. No open issues. |
| 48 | disabled-field | 91 | ^19.2.4 | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
| 49 | copy-links | 0 | none | Done | On 3.1.0-next.1 and the updated skill. Build pass, lint pass, tests none. No open issues. |
