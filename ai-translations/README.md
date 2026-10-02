# AI Translations

Translate your DatoCMS content into every locale of your project with DeepL, OpenAI, Google Gemini, Anthropic Claude or Yandex Translate. Translate a single field, a whole record, a selection of records or entire models, without leaving DatoCMS.

![A blog post open on its Italian tab with the title and content translated, next to the AI Translations sidebar panel listing each finished field and locale, such as "Title" to Italian [it], and a notice asking to review the translations and save](docs/record-translated.png)

- **Translate one field** into one locale or all of them, from the field's menu
- **Translate a whole record** from its sidebar, and review the result before saving
- **Translate many records at once**: a selection from a table, or every record of the models you pick
- **Five providers**: DeepL, OpenAI, Google Gemini, Anthropic Claude and Yandex Translate
- **Rich content included**: HTML, Markdown, Structured Text, blocks, SEO fields and image alt text
- **Publish in one click** after a bulk run, for models with draft/published

## Installation

Install **AI Translations** from **Configuration → Plugins** and, when asked, let it use the current user's API token. Bulk translations need it to read and save records. Without it, the table action and the Bulk translations page can't run.

Then open the plugin settings, pick an **AI Vendor**, enter its credentials and click **Save**. Your project needs at least two locales.

### Choose a provider

DeepL is the fastest and cheapest option, and it's what we recommend for most projects. OpenAI, Gemini and Claude are language models: they also get the record's title and other short text fields as context, which helps with tone and terminology, and you can edit the **Translation prompt** they follow.

<img src="https://raw.githubusercontent.com/datocms/plugins/master/ai-translations/docs/settings.png" width="560" alt="The plugin settings with the AI Vendor menu open, listing OpenAI (ChatGPT), Google (Gemini), Anthropic (Claude), DeepL and Yandex Translate">

| AI Vendor | What you need |
| --- | --- |
| **DeepL** | A DeepL API key. For a Free-plan key, turn on **Use DeepL Free endpoint (api-free.deepl.com)**. It turns on by itself for keys ending in `:fx`. **Test API Key** checks the key. |
| **OpenAI (ChatGPT)** | An OpenAI API key, then a **GPT Model** from the list of models your key can use. |
| **Google (Gemini)** | A Google API key from a project with the Generative Language API enabled, then a **Gemini Model**. |
| **Anthropic (Claude)** | An Anthropic API key, then a **Claude Model**. |
| **Yandex Translate** | A service-account API key with the `yc.ai.translate.execute` scope, from an account with the `ai.translate.user` role. **Yandex Folder ID** is optional. **Test credentials** checks them. |

The same page lets you choose the **Fields that can be translated** and turn the sidebar panel or the table action off. Turn on **Show exclusion rules** to hide the plugin from some models or roles, or to skip specific fields. DeepL glossaries, the prompt and the other provider options are described in [docs/Providers.md](docs/Providers.md).

## Translate a field

Open the menu at the top right of a localized field, choose **Translate to**, then a locale or **All locales**. **Translate from** works the other way round: it fills the locale you're on with a translation of another locale.

<img src="https://raw.githubusercontent.com/datocms/plugins/master/ai-translations/docs/field-menu.png" width="700" alt="The menu of the Title field open on Translate to, listing All locales, Italian [it], German [de], French [fr] and Spanish [es]">

The translation goes into the form, so review it and click **Save**. **Translate to** only appears once the field has content in the locale you're on.

## Translate a whole record

The **AI Translations** panel in the record sidebar translates every translatable field at once.

1. Pick the **From** locale and the **To** locales. All the other locales are selected by default.
2. Click **Translate all fields**. Each field and locale shows up in the panel as it's translated. Click one to jump to that field.
3. Review the translations in the form and click **Save**.

<img src="https://raw.githubusercontent.com/datocms/plugins/master/ai-translations/docs/record-panel.png" width="300" alt="The AI Translations sidebar panel set to translate from English to Italian, German, French and Spanish, with the Translate all fields button">

**Cancel** stops the run. Fields that were already translated stay in the form.

## Translate records from a table

1. Open a model's records, select the ones to translate, then open the **⋮** menu in the bar at the bottom and choose **AI Translate these records**.
2. In **Translate records**, pick the **Source locale** and the **Target locales** (**All other locales** by default). Then pick the fields to translate for each model (**All fields** by default).
3. Click **Translate *N* records**, check the summary and confirm.
4. The **Translation progress** dialog follows each record. See [Understanding the results](#understanding-the-results).

<img src="https://raw.githubusercontent.com/datocms/plugins/master/ai-translations/docs/records-modal.png" width="520" alt="The Translate records dialog for 3 selected Blog Post records: English as the source locale, All other locales as targets, all 3 translatable fields selected, and the Translate 3 records button">

Unlike the field menu and the sidebar, bulk translations save each record as soon as it's translated. In models with draft/published, the changes stay unpublished until you publish them.

## Translate whole models

Open **Configuration → Bulk translations**, under **AI Translations** in the sidebar. Only roles that can edit the schema see it.

Pick the locales, then the **Models** to translate: every record of those models is translated. Each model gets its own field picker, with all its translatable fields selected. Click **Translate records**, confirm, and follow the run in the same **Translation progress** dialog. If the button is disabled, hover it to see what's missing.

![The Bulk translations page with English as the source locale, All other locales as targets, and the selected models, each with its own field picker](docs/bulk-page.png)

Block models aren't listed, because blocks are translated together with the records that contain them.

## Understanding the results

The progress dialog counts successful and failed records as the run goes. Each row links to its record, which opens in a new tab. Hover a row to see the details of a warning or an error. **Cancel** stops the run, and records that were already saved stay translated.

<img src="https://raw.githubusercontent.com/datocms/plugins/master/ai-translations/docs/progress.png" width="520" alt="The Translation progress dialog at 100%, with every selected record marked Translated">

| Status | What it means |
| --- | --- |
| **Translated** | The selected fields were translated and the record was saved. |
| **— with warnings** | The record was saved, but needs a look. Usually linked records were copied into a new locale, or one field was skipped because the provider returned an error. |
| **No eligible fields to translate** | The selected fields are empty in the source locale, so nothing changed. |
| **Missing source locale** | The record has no content in the source locale. |
| **Failed** or **No fields were updated** | The record couldn't be translated or saved. Hover the row to see why. |

**Why are linked records copied?** A link field points to other records, which are the same in every locale, so the plugin never translates it. When a bulk run fills a locale for the first time, it copies the links from the source locale so the record stays valid, for example when the field requires at least one linked record. The linked records themselves aren't translated. The warning lets you check whether the new locale should link to different records.

**Publishing.** When the run ends, **Publish all translated records (*N*)** publishes every record that was updated, if its model uses draft/published. If publishing stops partway, click **Retry publishing remaining (*N*)**.

## Good to know

- **What gets translated:** localized fields of the types picked in **Fields that can be translated**: single-line strings, textareas, Markdown, HTML, slugs, JSON, SEO, Structured Text, Modular Content, and the alt text and title of media. All types are on by default. Fields that aren't localized are never changed.
- **Translations replace what's there.** Translating into a locale overwrites the content it already has in the selected fields.
- **Linked records stay the same.** Link fields are never translated, and neither are the records they point to.
- **SEO limits:** translated SEO titles longer than 60 characters and descriptions longer than 160 are cut short and end with "...".
- **API keys** are saved in the plugin settings and used from each editor's browser, so treat them as visible to your team. Use a dedicated key, and restrict it where the provider allows, such as a Google key limited to the Generative Language API.
- **DeepL glossaries:** open **Glossary Settings** in the DeepL settings to apply your DeepL glossaries, as a **Default glossary** or for specific language pairs. If a glossary doesn't match the languages being translated, the text is translated without it.
- **Yandex Translate** accepts at most 10,000 characters per piece of text. A longer field, such as a long HTML or Markdown text, fails with an error asking you to shorten it.
- **Two locales or more:** translation actions need a second locale in the record, and in the environment for bulk runs.
- **Debug logging:** **Enable debug logging** prints each translation request and response to the browser console, with API keys hidden.

## Development

From this directory:

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Connect the development URL to a test project using the [DatoCMS plugin development workflow](https://www.datocms.com/docs/plugin-sdk/build-your-first-plugin). The release history is in the [changelog](https://github.com/datocms/plugins/blob/master/ai-translations/CHANGELOG.md).
