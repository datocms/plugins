__NEED_NEW_IMAGE__
# Locale Duplicate

Copies localized content from one locale to another. You can copy a whole locale across the models you choose, or add copy buttons to specific localized fields in the record editor.

It's handy for renaming a locale (add the new one, copy the old one into it, then remove the old one) or for starting a new locale from a similar one, like `en-UK` from `en-US`.

Install the plugin and allow it to use the current user's API token.

## Copying a whole locale

![The Mass Locale Duplication page](https://github.com/user-attachments/assets/3770f94d-4206-450b-bf0b-beebcce6cf44)

Open **Configuration → Mass Locale Duplication**, pick the source and target locales, and choose which models to include. Blocks are copied along with the records that contain them.

By default the latest draft content is copied. Turn off **Use records in draft state** to copy only published records and their published content. Turn on **Publish updated records automatically after duplication** to publish the records once they're updated.

Click **Duplicate locale content** and confirm twice. You'll see each record as it's processed and a summary of successes and failures per model at the end.

## Before you run it

Everything in the target locale of the selected models is overwritten with the source content. Other locales are left alone.

Keep the page open until the run finishes, and avoid editing content in the selected models while it's going. **Abort Process** stops it, but records already updated stay updated.

Copying a locale adds content to each record, so large records can go over the [CMA limits](https://www.datocms.com/docs/content-management-api/technical-limits) on record size and nested blocks. Those records fail and are counted as errors in the summary.

## Copy buttons on fields

![Copy buttons on a localized field in the record editor](https://github.com/user-attachments/assets/f12b5e08-8c4b-499f-9ea2-6e2e3269d6d6)

In **Configuration → Plugins → Locale Duplicate**, pick a model and one of its localized fields, click **Add Configuration** for each field you want, then **Save Configuration**. String, text, Structured Text, JSON, SEO and slug fields are supported.

The record's first locale is treated as the main one. In that locale the button reads **Copy to all locales** and copies the value into every other locale. In any other locale it reads **Copy from** followed by the main locale, and pulls that value in. Save the record as usual afterwards. Records with a single locale don't show the button.

## Development

```sh
npm ci
npm run dev
npm run check
```
