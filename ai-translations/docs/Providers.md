# Providers and settings

This page covers the plugin settings in more detail than the [README](../README.md). Pick the provider under **AI Vendor**, fill in **Vendor-specific settings**, adjust **General translation settings** if needed, and click **Save**.

## DeepL

- **Key:** use a key from your DeepL account, Pro or Free. Free keys end in `:fx` and need **Use DeepL Free endpoint (api-free.deepl.com)**. The switch turns on by itself when you paste such a key.
- **Test API Key** translates "Hello world" into German and shows the result. If a Free key is tested without the Free endpoint, the message tells you to turn the switch on.
- **Formality** makes translations more or less formal. Target languages that DeepL can't adjust keep its default tone.
- **Tag Settings → Preserve formatting** (on by default) asks DeepL to keep the original punctuation and casing instead of correcting them.
- **Tag Settings** also has three comma-separated lists of tag names: **Ignore tags** keep their content untranslated (`notranslate,ph` by default), **Non-splitting tags** never split a sentence (`a,code,pre,strong,em,ph,notranslate` by default), and **Splitting tags** always start a new one (empty by default).
- Requests go through DatoCMS's CORS proxy (`cors-proxy.datocms.com`), because DeepL can't be called directly from the browser. You don't need to set anything up.

### Glossaries

Open **Glossary Settings** to enforce your own terminology. The plugin lists the glossaries your key can use, with their languages and number of entries. They work with every field type, Structured Text included.

- **Default glossary** is used when no language pair below matches the translation.
- **+ Add language pair** adds a row with **From**, **To** and **Glossary**. **From** and **To** can be a project locale or **All (\*)**.

For each translation, the plugin picks the first match among: the exact language pair, any language into the target, the source into any language, and finally the default glossary. A glossary whose languages don't match the translation is skipped, and if DeepL still rejects it, the text is translated again without it. Glossaries are read through DeepL's v2 glossary API and only apply to DeepL.

## OpenAI, Google Gemini and Anthropic Claude

| AI Vendor | Key | Model list |
| --- | --- | --- |
| **OpenAI (ChatGPT)** | A secret key from your OpenAI account. | **GPT Model** lists the chat models your key can use. Embedding, audio, moderation, image and realtime models are left out. |
| **Google (Gemini)** | A key from a Google Cloud project with the Generative Language API enabled. Restrict it to that API and by HTTP referrer if you can. | **Gemini Model** lists the text-generation models of that API. |
| **Anthropic (Claude)** | A key from the Anthropic Console. | **Claude Model** lists the models your key can use. |

The lists load once you enter a valid key. If a list shows "Invalid API Key", check that the key matches the selected vendor.

### The translation prompt

Language models follow the **Translation prompt** in **General translation settings**. It isn't shown for DeepL or Yandex Translate. The prompt can use these placeholders:

| Placeholder | Replaced with |
| --- | --- |
| `{fieldValue}` | The content to translate. |
| `{fromLocale}` | The source language. |
| `{toLocale}` | The target language. |
| `{recordContext}` | Short text fields of the record in the source locale (under 300 characters, with an API key containing `title`, `name`, `content` or `description`), so the model knows what the record is about. |

The default prompt keeps names and brands unchanged, keeps the original formatting, and preserves [ICU message format](https://unicode-org.github.io/icu/userguide/format_parse/messages/) strings: in `{count, plural, one {# message} other {# messages}}`, only the words inside the brackets are translated. Changing the prompt can break translations, so test it on a single field first. **Restore to defaults** brings back the default prompt and general settings, and switches the vendor back to OpenAI. Click **Save** to apply it.

## Yandex Translate

- **Key:** create a Yandex Cloud service account with the `ai.translate.user` role, and an API key with the `yc.ai.translate.execute` scope. See the [Yandex Translate setup guide](https://aistudio.yandex.ru/docs/en/translate/quickstart.html).
- **Yandex Folder ID** is optional. Leave it empty to let Yandex use the service account's home folder.
- **Test credentials** asks Yandex for its list of supported languages and reports how many it returned.
- Locales are matched to Yandex's languages exactly first (such as `pt-BR` or `sr-Latn`), then by base language (`fr-CA` becomes `fr`). A target locale Yandex doesn't support stops with an error.
- Each request holds at most 10,000 characters. Longer content is split into several requests, but a single piece of text over the limit fails with an error asking you to shorten it, so HTML, Markdown and placeholders are never cut in half.
- Requests go through DatoCMS's CORS proxy, because Yandex can't be called directly from the browser.
- Spell checking, custom models, inline glossaries and IAM-token sign-in aren't supported.

## Exclusion rules

Turn on **Show exclusion rules** in **General translation settings** to see three lists:

- **Models to be excluded from this plugin:** hides the field menu actions, the sidebar panel and the table action for those models.
- **Roles to be excluded from using this plugin:** hides the same actions for those roles.
- **Fields to be excluded from translation:** skips those fields everywhere, bulk translations included.

## Troubleshooting

- **The translation actions don't appear:** the field must be localized, its type must be in **Fields that can be translated**, it mustn't be excluded, and the record needs at least two locales.
- **"Please configure valid AI vendor credentials":** the selected vendor has no key, or no model for OpenAI, Gemini or Claude. Open the plugin settings and save valid credentials.
- **Rate limit or quota errors:** translate fewer records at a time, pick a lighter model, or raise your quota with the provider.
- **Model not found:** pick another model from the list. Providers retire models over time.
- **Understanding a failure:** turn on **Enable debug logging** and repeat the translation. Each request and response is printed to the browser console, with API keys hidden.
