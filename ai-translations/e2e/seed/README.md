# AI Translations — E2E project seed

Seeds the **AI Translation E2E** DatoCMS project (id `219952`) with locales, a
content model covering every editor the plugin can translate, and a record set
in deliberate permutations for end-to-end testing of the translation flows.

## What it builds

**Locales (12, world-spanning, `en` primary):**
`en, es, pt-BR, fr, de, it, ru, ar, ja, zh-Hans, hi, sw` — covers North America,
Iberia + Latin America, South America, W/C/S/E Europe, MENA (RTL), East Asia
(two scripts), South Asia, Sub-Saharan Africa.

**Schema** — two content models + five reusable block models. Every translatable
editor appears as a localized top-level field; a few non-localized / numeric
fields provide negative coverage (the plugin must leave them untouched).

| Editor | Where |
| - | - |
| `single_line`, `slug`, `textarea`, `markdown`, `wysiwyg`, `json`, `seo` | article + product top-level |
| `structured_text` (with embedded blocks) | `article.structured_body` |
| `rich_text` (Modular Content, multi-block) | `article.content_blocks`, `product.features` |
| `framed_single_block` (single block) | `article.spotlight`, `product.hero` |
| `frameless_single_block` (single block, inline-localized path) | `article.inline_note` |
| `file` (single asset) | `article.cover_image`, `product.main_image`, `hero.background_image` (nested in block) |
| `gallery` (multi asset) | `article.media_gallery` |

Block inner fields are non-localized (per-locale variation comes from the
localized container field); `hero` contains a nested `file` field to exercise
asset translation inside blocks.

**Assets** — four locally-generated PNGs (no external host) uploaded with `en`
`alt`/`title` default metadata. Records also set `alt`/`title` directly on file
values (the plugin's upload-default enrichment is shape-mismatched and never
fires, so field-level metadata is what actually gets translated).

**Records (10)** — each has two populated locales (a source + one other); the
remaining locales are left empty for the suite to translate into. A1–P3 are the
core set; A5–A7 additionally target specific plugin code paths surfaced by an
adversarial audit of the seed against the plugin source.

| # | Model | Locales | Focus |
| - | - | - | - |
| A1 | article | en+it | Kitchen sink — every editor populated |
| A2 | article | en+es | Sparse — few fields |
| A3 | article | it+es (en empty) | Non-EN source; inline blocks + modular content |
| A4 | article | en+de | Blocks-heavy — modular + framed + frameless + gallery(3) |
| A5 | article | en+fr | QC torture — tricky HTML/markdown/marks/links/nested JSON; **placeholder tokens** (`{{name}}`,`{count}`,`%s`,`:slug`); **over-limit SEO** (>60/>160) |
| A6 | article | ar+zh-Hans (en empty) | **Non-Latin/RTL/CJK + hyphenated source** (exercises the `from-to` action-ID splitter); placeholder + ICU tokens; **block-only** structured text; mixed filled/empty optional blocks |
| A7 | article | en + partial ru | **Pre-filled target locale** (ru on title+seo only) → overwrite-vs-preserve branch; placeholder token in a JSON field |
| P1 | product | en+es | Full product — features (multi) + hero (single) |
| P2 | product | es+de (en empty) | Non-EN source on second model |
| P3 | product | en+it | Minimal — name, slug, description, seo |

> **Placeholder coverage** (A5/A6/A7) drives the `feature/translation-qc`
> tokenize → detokenize → `checkPlaceholderSurvival` pipeline. Tokens are
> byte-identical across locales and must survive translation untouched.

## Running

```bash
cd e2e-seed
npm install                 # @datocms/cma-client-node
node 1-schema.mjs           # locales + schema (idempotent)
node 2-uploads.mjs          # assets (writes uploads.json)
node 3-records.mjs          # the 8 core records (reads uploads.json)
node 3b-coverage-records.mjs # +A6 (non-Latin source) +A7 (partial target) + A5 top-up (idempotent)
node 4-verify.mjs           # coverage report + assertions
node 5-manifest.mjs         # writes seed-manifest.json for the E2E suite
```

The CMA token is read from `../.env.testing` (`E2E_PROJECT_CMA_TOKEN`). Stages
1 and 2 are idempotent; stage 3 is not (re-run against a fresh/empty project, or
delete existing records first).

`seed-manifest.json` lists every record with its `sourceLocales` and
`emptyTargetLocales` — the suite iterates these to drive translations and assert
results.
