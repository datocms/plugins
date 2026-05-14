__NEED_NEW_IMAGE__
# Locale Duplicate

A DatoCMS plugin that provides two complementary features for managing
multilingual content:

1. **Mass Locale Duplication** — bulk copy all content from one locale to
   another across selected models.

![88846](https://github.com/user-attachments/assets/3770f94d-4206-450b-bf0b-beebcce6cf44)


2. **Field-Level Copying** — one-click copy buttons on individual localized
   fields while editing a record.

![39050](https://github.com/user-attachments/assets/f12b5e08-8c4b-499f-9ea2-6e2e3269d6d6)

This can be useful when you need to:

- Migrate content from an old locale code to a new one (and optionally remove
  the old locale afterward).
- Duplicate content between two similar locales (e.g., `en-US` and `en-UK`) as
  a starting point before making minor adjustments.
- Selectively copy specific localized field values across locales while
  editing a single record.

## Features

### Mass Locale Duplication

- Pick a source and a target locale from the project's available locales.
- Choose which models participate in the duplication (all are selected by
  default).
- Toggle whether to read draft records (otherwise only published records are
  duplicated).
- Toggle whether to automatically publish updated records after duplication.
- Two-step confirmation flow before any data is touched.
- Live progress view with per-record success/error logs and the ability to
  abort mid-run.
- Final summary view with success/failure counts grouped by model.

### Field-Level Copy

- A copy button is added as an addon on each field selected in the plugin's
  configuration.
- The plugin treats the first locale of the record as the **main locale**:
  - When editing the main locale, the button is labeled
    **Copy to all locales** and copies the current field value into every
    other locale of the record.
  - When editing any other locale, the button is labeled
    **Copy from `<main-locale>`** and copies the main-locale value into the
    current locale.
- The button is hidden on records that only have a single locale.
- Supports string, text, structured text, JSON, SEO, and slug field types.
- Nested block IDs are stripped from the copied value so the
  duplicated structured/block content gets new IDs on save.

## Configuration

### Mass Locale Duplication

No special configuration required. Open it from
**Configuration → Mass Locale Duplication**.

### Field-Level Copy

1. Open Configuration → Plugins → **Locale Duplicate**.
2. Pick a **Model**, then pick a **Localized Field** from that model
   (non-localized fields are filtered out, and already-configured fields are
   excluded from the dropdown).
3. Click **Add Configuration**, repeat for any other field/model combos.
4. Click **Save Configuration** to persist the list to the plugin parameters.
5. Copy buttons appear automatically on the configured fields when editing a
   record with more than one locale.

The configuration screen also includes a shortcut button that navigates
directly to the Mass Locale Duplication page.

## Usage

### Mass Locale Duplication

1. Navigate to **Configuration → Mass Locale Duplication** in
   your DatoCMS project.
2. Choose the **Source Locale** (the locale that has the content you want to
   duplicate).
3. Choose the **Target Locale** (the locale that will receive the copied
   content).
4. Select which models you want to duplicate:
   - By default, all non-modular-block models are selected.
   - Deselect any models you don't want to include in the run.
5. Optionally toggle:
   - **Use records in draft state** — include draft content in the copy.
   - **Publish updated records automatically after duplication** — bulk
     publishes records that were successfully updated.
6. Click **Duplicate locale content**.
7. Confirm the two prompts: first that you really want to duplicate, then
   that you accept the target locale will be overwritten.
8. Watch the progress view (per-record updates with status, model, and IDs).
   You can **Abort Process** at any time; in-flight changes are kept but no
   further records are touched.
9. Once finished, review the summary view with success/failure counts and
   record IDs grouped by model.

### Field-Level Copy

1. Configure fields in the plugin configuration as described above.
2. Open a record in the record editor with more than one locale.
3. On the configured fields:
   - In the main locale, click **Copy to all locales** to push the current
     value into every other locale.
   - In any other locale, click **Copy from `<main-locale>`** to pull the
     main locale's value into the current one.

## Common Use Cases

### Renaming a Locale

1. Create a new locale in **Configuration → Locales** (e.g., add `en-NEW` next to
   the existing `en-OLD`).
2. In the **Locale Duplicate** plugin, choose `en-OLD` as the source and
   `en-NEW` as the target.
3. Run Mass Locale Duplication.
4. Remove the old locale (`en-OLD`) from **Settings → Locales** if desired.

### Setting Up a Similar Locale

If you have a locale like `en-US` and want a similar locale like `en-UK`:

1. Create `en-UK` in **Settings → Locales**.
2. In the plugin, select `en-US` as the source and `en-UK` as the target.
3. Run Mass Locale Duplication.

### Updating Specific Content Types

If you've made major updates to certain models in one locale and want to
propagate only those changes:

1. Select your source and target locales.
2. Deselect every model except the ones you specifically want to update.
3. Run Mass Locale Duplication on the reduced selection.

### Copying a Field Value Within a Single Record

1. Open a record with multiple locales.
2. On a configured field, use **Copy to all locales** (from the main locale)
   or **Copy from `<main-locale>`** (from any other locale) to sync the
   field's localized values without leaving the editor.
