# AI Translations

This plugin integrates with AI providers and provides on-demand AI-powered translations for your fields. You can also translate entire records or perform bulk translations across multiple records and models.

![47659](https://github.com/user-attachments/assets/2aae06c5-d2fb-404d-ae76-08b5ebd55759)

![31841](https://github.com/user-attachments/assets/a1b4e9aa-d79e-4807-8b90-16b06b65852c)

## Configuration

On the plugin's Settings screen:

1. **AI Vendor**: Choose your provider — OpenAI (ChatGPT), Google (Gemini), Anthropic (Claude), or DeepL.
2. If you chose OpenAI:
   - **OpenAI API Key**: Paste a valid OpenAI key.
   - **GPT Model**: After entering your key, the plugin lists available chat models. Select a model from the dropdown.
3. If you chose Google (Gemini):
   - **Google API Key**: Paste a valid key from a GCP project with the Generative Language API enabled.
   - **Gemini Model**: Select a model from the dropdown.
4. If you chose Anthropic (Claude):
   - **Anthropic API Key**: Paste a valid Anthropic key.
   - **Claude Model**: Select a model from the dropdown.
5. If you chose DeepL:
   - **DeepL API Key**: Paste your DeepL API key.
   - **Use DeepL Free endpoint**: Enable this if your key ends with `:fx` (Free plan).
6. **Prompt Template** (AI vendors only): Customize how translations are requested. Use `{fieldValue}`, `{fromLocale}`, `{toLocale}`, and `{recordContext}`.
7. **Translatable Field Types**: Pick which field editor types (single_line, markdown, structured_text, etc.) can be translated. 
8. **Translate Whole Record**: Enable the sidebar that translates every localized field in a record.
9. **Translate Bulk Records**: Enable bulk translations from table view or via the dedicated page.
10. **AI Bulk Translations Page**: Translate whole models at once.
11. **Enable Debugging**: Optional toggle that prints detailed logs to the browser console while keeping API keys redacted.

### Key Restrictions and Security
- Keys are stored in plugin settings and used client-side. Do not share your workspace publicly.
- Prefer restricting keys:
  - OpenAI: regular secret key; rotate periodically.
  - Google: restrict by HTTP referrer and enable only the Generative Language API.
- The plugin redacts API keys from debug logs automatically.

_**Models**_
- OpenAI: the model list is fetched dynamically for your account; the plugin filters out embeddings, audio/whisper/tts, moderation, image, and realtime models.
- Google: the model list is fetched dynamically from the Generative Language API.
- Anthropic: the model list is fetched dynamically for your account.

Save your changes. The plugin is now ready.

## Usage

### Field-Level Translations

For each translatable field:

1. Click on the field's dropdown menu in the DatoCMS record editor (on the top right of the field)
2. Select "Translate to" -> Choose a target locale or "All locales."
3. The plugin uses your configured AI vendor settings to generate a translation.
4. The field updates automatically.

You can also pull content from a different locale by choosing "Translate from" to copy and translate that locale's content into your current locale.

### Whole-Record Translations

If enabled:

1. Open a record that has multiple locales.
2. The "AI Translations" panel appears in the sidebar.
3. Select source and target locales, then click "Translate Entire Record."
4. All translatable fields get updated with AI translations.

### Bulk Translations from Table View

Translate multiple records at once from any table view:

1. In the Content area, navigate to any model's table view
2. Select multiple records by checking the boxes on the left side
3. Click the three dots dropdown in the bar at the bottom (to the right of the bar) and choose "AI Translate these records"
4. In the picker, choose your source and target languages (the target defaults to "All other locales") and, optionally, narrow which fields are translated per model
5. Review the confirmation summary, then watch the progress modal as all selected records are translated

![Bulk Translations Table View](https://raw.githubusercontent.com/marcelofinamorvieira/datocms-plugin-ai-translations/refs/heads/master/public/assets/bulk-translation-example.png)

### AI Bulk Translations Page

The plugin includes a dedicated page for translating multiple models at once:

1. Go to Settings → AI Bulk Translations (in the sidebar) — this entry only appears for users whose role can edit the schema.
2. Select your source and target languages (the target defaults to "All other locales")
3. Choose one or more models to translate (block models are excluded); each model appears as a card where you can refine which fields are translated
4. Click "Start Bulk Translation" and review the confirmation summary of locales, models, and fields
5. The modal will display progress as all records from the selected models are translated

If anything required is missing (for example a model with no fields selected, or no target locale), the page lists exactly what's left before the Start button enables.

![AI Bulk Translations Page](https://github.com/user-attachments/assets/eefd5f25-efc7-4f3b-bf49-ff05d623b35c)

### Linked records and warnings

Link and Links fields (references to other records) are **not translated** — a reference points at the same shared record regardless of locale. When you translate into a new locale, the plugin copies those references from the source locale so the new locale is valid. This also prevents failures on fields that require a minimum number of linked records, which used to abort the whole record's translation. The linked records themselves are never followed or re-translated.

Whenever this happens, the record's row in the bulk progress modal is flagged with an amber warning icon and a **"— with warnings"** label; its title links (in a new tab) to the record, and hovering the row reveals the full detail in a tooltip. Any fields that genuinely failed to translate are surfaced the same way.

The modal also has an **Export CSV** button that downloads a per-record report — status (success/warning/failure), the CMA update timestamp, record ID, title, edit URL, source and target locales, the field IDs (and api keys) that were translated, the link-field IDs whose references were copied without translation, and a notes column with the warnings — handy for auditing a large run or handing follow-up work to an editor.

### Reliability

Bulk translation is built to fail loudly rather than quietly corrupt your content:

- **Rate limits pause the run.** When a provider returns a rate-limit error, the run retries automatically up to three times with exponential backoff (honoring the provider's `Retry-After` hint when it is readable). The progress modal shows a countdown — _"Retrying automatically in Ns…"_ — during the wait. If all three retries are exhausted, the run pauses and waits for you to click **Resume**.
- **Auth and quota errors pause immediately.** These need a human to fix an API key or billing, so there is no auto-retry or countdown — the run pauses at once and enables **Resume** so you can retry after resolving the problem.
- **A failed field never corrupts existing content, and one field's failure doesn't sink the whole record.** If a field's translation fails and that locale already had a value, the existing value is preserved — never overwritten with an empty one. When translating into a brand-new locale, the failed field is left empty (and flagged for review) so the record's other fields still translate and save, instead of the whole record being rejected. The plugin distinguishes "we couldn't translate this" (a failure) from "this field has nothing to translate".
- **A record with any failed field is reported as failed**, and its status names the affected locale (for example, _French [fr]: 1/3 fields translated_), so a healthy locale can never mask a wholly-dead sibling.
- **Export is available only once the run finishes or is stopped.** It is deliberately disabled while the run is active or paused, because a mid-run CSV would look like a finished report while omitting everything after the pause point.
- **Cancelling does not roll back records already written.** Stopping the run leaves the records translated so far in place; they will be re-translated on the next bulk run.

## Contextual Translations

The plugin now supports context-aware translations through the `{recordContext}` placeholder:

- **Benefits**:
  - Better understanding of specialized terminology
  - Improved consistency across related fields
  - More accurate translations that respect the overall content meaning
  - Appropriate tone and style based on context

## ICU Message Format Support

The plugin supports **[ICU Message Format](https://unicode-org.github.io/icu/userguide/format_parse/messages/)** strings, ensuring that complex pluralization and selection logic is preserved during translation.

- **Smart Masking**: Simple variables like `{name}` are masked to protect them, while ICU structures like `{count, plural, ...}` are passed to the AI.
- **AI Instructions**: The AI is explicitly instructed to preserve the ICU structure and keywords, translating only the human-readable content inside.

**Example:**
```
You have {count, plural, one {# message} other {# messages}}
```
Becomes:
```
Você tem {count, plural, one {# mensagem} other {# mensagens}}
```

## Customizing Prompts

You can customize the translation prompt template in the plugin settings:

- Use `{fieldValue}` to represent the content to translate
- Use `{fromLocale}` and `{toLocale}` to specify languages
- Use `{recordContext}` to include the automatically generated record context

## Excluding Models, Roles or Fields

In the plugin's "Exclusion Rules" section you can suppress translation actions and the sidebar panel for specific:

- **Models**: Choose models to exclude from translations
- **Roles**: Choose roles to hide all plugins functions from
- **Fields**: Choose individual fields that should be excluded, even when their model is included — including fields **inside blocks** (listed as "_field_ (_Block_ block)"), so you can leave one nested field untranslated while the rest of the block is translated. The field list is populated for every AI vendor.

## Translation Quality Checks

The plugin verifies each AI translation for completeness and surfaces anything that looks off, so an incomplete result is never saved silently.

It checks for:

- **Dropped or truncated content** — a response with the wrong number of segments, an individual segment that came back untranslated (left as its source text), a model that hit its output-token limit, or a multi-block HTML field the model split apart. These are repaired where possible (e.g. an over-split HTML field is rejoined, a missing slot keeps the source) and flagged.
- **Lost placeholders** — `{{var}}`, `{var}`, `%s`, `:slug`, and ICU tokens that disappear in translation.
- **Structural drift** — HTML or Markdown whose block structure (paragraphs, headings, lists, links) no longer matches the source.
- **Likely non-translations** — output identical to the source, or far shorter than expected.
- **Over-long values** — a value past a field's `length` validator (which DatoCMS would reject on save), and a translated SEO title/description past the recommended length that the plugin trims to fit — flagged so the cut is never silent.

Where you see the results:

- **Single field / whole record** (sidebar and field dropdown): after translating, a short summary appears — a blocking alert when content may be incomplete, a notice for softer warnings — so you can review before saving.
- **Bulk**: a record with a content-corrupting issue (a truncated response, a lost placeholder, a structurally-drifted value, or a value that overflows a field's length limit) is marked as a **failure**, while a record with only softer suspicions (a wrong-length response, a segment that came back untranslated, a likely non-translation, an unusually short value, or a trimmed SEO title) — or one whose only change was copying linked-record references into the new locale (see [Linked records and warnings](#linked-records-and-warnings)) — is marked **"completed with warnings"**, both distinct from clean successes, in the progress modal. The counters split into successful / with warnings / failed, and every record (with its status and reason) is available in the after-run review list and the **Export CSV** report.

The checks are advisory and never block your work; they highlight fields worth a human glance.

## Troubleshooting

- **Invalid API Key**: Ensure your key matches the selected vendor and has access.
- **Rate Limit/Quota**: Reduce concurrency/batch size, switch to a lighter model, or increase your vendor quota.
- **Model Not Found**: Verify the exact model id exists for your account/region and is spelled correctly.
- **Localization**: Make sure your project has at least two locales, otherwise translation actions won't appear.
- **"Field may be incomplete" / a failed or "completed with warnings" record**: A quality check flagged a possible dropped, truncated, or placeholder issue. The value was still applied (repaired where possible) — review the flagged field. In bulk, content-corrupting issues mark the record as failed while softer suspicions show as "completed with warnings". A truncation warning usually means the model hit its output-token limit; try a smaller field or a model with a larger output limit.

## DeepL Glossaries

The plugin supports DeepL glossaries to enforce preferred terminology. You can set a default glossary ID and/or map specific language pairs to specific glossary IDs. This works for all field types, including Structured Text.

### Requirements

- A DeepL API key with access to Glossaries. Check your DeepL account/plan capabilities.
- Currently only tested against DeepL v2 glossaries. Use v3 at your own risk (https://developers.deepl.com/api-reference/glossaries/v2-vs-v3-endpoints)

### Configure DeepL Glossaries in the Plugin

1. Open the plugin settings and choose the vendor "DeepL".
2. Enter your DeepL API Key and verify it via the "Test API Key" button.
3. Expand "Glossary Settings".
4. We automatically detect glossaries available to your API key.
5. Optional: Set "Default glossary ID" (e.g., `abc123-efg456-etc`) from the available list. This will only apply to translations of this language pairing, and will be ignored otherwise.
6. Optional: Specify one or more explicit language pairings using the pairing builder: 
  ![pairing builder](./public/assets/pairing-builder.png)

### Resolution Order

When translating from `fromLocale` → `toLocale`, the plugin picks a glossary ID using this precedence:

1. Exact pair match by your project locales (e.g., `en-US:pt-BR`).
2. Wildcard any→target (e.g.`*:pt-BR`).
3. Wildcard source→any (e.g. `en:*` or `en-US:*`).
4. Default glossary ID (if set and applicable).
5. Otherwise, no glossary is used.

If DeepL returns a glossary mismatch (e.g., glossary languages don't match the current pair) or a missing glossary, the plugin automatically retries the same request once without a glossary so your translation continues. A brief hint is surfaced in the UI logs.

### Tips and Limitations

- Glossaries apply only to the DeepL vendor. OpenAI/Gemini/Anthropic do not use glossaries.
- The plugin preserves placeholders and HTML tags automatically (`notranslate`, `ph`, etc.). Glossaries will not alter those tokens. This behavior can be configured in the DeepL Tag Settings.
- If you set a DeepL "formality" level, it is sent only for targets that support it; otherwise omitted.
- Ensure you test the API key after entering it to catch any potential errors.

### Quick Sanity Test

1. Create a small EN→DE glossary with an obvious term (e.g., "CTA" → "Call-to-Action").
2. In Settings → DeepL, paste the glossary ID into either Default or the `EN->DE=...` mapping.
3. Translate a field from EN to DE containing "CTA". The resulting German text should include your glossary translation.

## Migration Notes

- Existing installations continue to work with OpenAI by default; your current `apiKey` and `gptModel` remain valid.
- To use Google (Gemini):
  1. In Google Cloud, enable the Generative Language API for your project.
  2. Create an API key and restrict it by HTTP referrer if possible.
  3. In the plugin settings, switch vendor to Google (Gemini), paste the key, and select a Gemini model.
- To use Anthropic (Claude):
  1. Get an API key from the Anthropic Console.
  2. In the plugin settings, switch vendor to Anthropic (Claude), paste the key, and select a Claude model.
- To use DeepL:
  1. Get an API key from your DeepL account (Pro or Free).
  2. In the plugin settings, switch vendor to DeepL and paste the key.
  3. If using a Free key (ends with `:fx`), enable "Use DeepL Free endpoint".

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

See the [full changelog](https://github.com/datocms/plugins/blob/master/ai-translations/CHANGELOG.md) for the release history.
