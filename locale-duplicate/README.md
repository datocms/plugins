# Locale Duplicate

A DatoCMS plugin that provides two powerful features for managing multilingual content:

1. **Mass Locale Duplication** - Bulk copy all content from one locale to another

![88846](https://github.com/user-attachments/assets/3770f94d-4206-450b-bf0b-beebcce6cf44)


2. **Field-Level Copying** - Copy individual field values between locales while editing records

![39050](https://github.com/user-attachments/assets/f12b5e08-8c4b-499f-9ea2-6e2e3269d6d6)

This can be useful when you need to:

- Migrate content from an old locale code to a new one (and optionally remove the old locale afterward).
- Duplicate content between two similar locales (e.g., `en-US` and `en-UK`) as a starting point before making minor adjustments.
- Selectively copy specific field values between locales during content editing.

## Features

### Mass Locale Duplication
- One-click duplication of all fields from a source locale to a target locale.
- Selective duplication of specific content models.
- Overwrites all fields in the target locale with the content from the source locale.
- Detailed operation console showing progress and record IDs.

### Field-Level Copy
- Copy buttons on individual fields in the record editor.
- Configure which fields should have copy functionality.
- Supports string, text, structured text, JSON, SEO, and slug field types.
- Copy field values between any configured locales while editing records.

## Configuration

### Mass Locale Duplication
No special configuration required. Access via Settings → Locale Duplicate.

### Field-Level Copy Feature
1. Open the plugin configuration screen.
2. Select which models and fields should have copy buttons.
3. Save your configuration.
4. Copy buttons will appear on configured fields when editing records.

## Usage

### Mass Locale Duplication

1. Navigate to **Settings** → **Locale Duplicate** in your DatoCMS project.
2. Choose the source locale (the locale that has the content you want to duplicate).
3. Choose the target locale (the locale that will receive the copied content).
4. Select which models you want to duplicate:
   - By default, all models are selected
   - Uncheck any models you don't want to include in the duplication process
   - This allows for targeted updates of specific content types
5. Click **Duplicate locale content**.
6. You will be prompted with two confirmation steps:
   - Confirm that you truly want to duplicate the content.
   - Confirm that you understand the existing target locale content will be overwritten.
7. Watch the progress in the Operation Console. Once finished, you'll see a summary of the duplication process with details on successful and failed records.

### Field-Level Copy

1. Configure fields in the plugin configuration:
   - Open the **Locale Duplicate** plugin configuration
   - Select models and fields that should have copy functionality
   - Save your configuration
2. When editing records:
   - Look for the copy button on configured fields
   - Click the button to open the locale selection
   - Click "Copy" to transfer the field value

## Common Use Cases

### Passing single field values across locales when editing a record:
1. Open a record in the record editor
2. Look for the copy button on configured fields
3. Click "Copy" to transfer the field value

### Renaming a Locale

1. Create a new locale in **Settings** → **Locales** (e.g., rename `en-OLD` to `en-NEW`).
2. In the **Locale Duplicate** plugin, choose `en-OLD` as the source and `en-NEW` as the target.
3. Duplicate the content.
4. Remove the old locale (`en-OLD`) from **Settings** → **Locales** if desired.

### Setting Up a Similar Locale

If you have a locale like `en-US` and want a similar locale like `en-UK`:

1. Create `en-UK` in **Settings** → **Locales**.
2. In the plugin, select `en-US` as the source and `en-UK` as the target.
3. Duplicate the content.

### Updating Specific Content Types

If you've made major updates to certain models in one locale and want to propagate only those changes:

1. Select your source and target locales.
2. Uncheck all models except the ones you specifically want to update.
3. Duplicate only the selected content models.
