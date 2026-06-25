# Changelog

- 3.5.7: Fix for Anthropic CORS and max-tokens issues (thanks @Techwolf12, #148).
- 3.5.6: Fixed AI translations cropping multi-block HTML fields (WYSIWYG / rich-text) to their first block. When a chat provider (OpenAI, Google/Gemini, Anthropic) split a single multi-paragraph field into one array element per block, the surplus blocks were silently dropped on save. They are now rejoined losslessly, and the translation prompt instructs the model to keep each field as a single element. DeepL was unaffected.
- 3.5.5: WYSIWYG / rich-text (HTML) fields are now translated with HTML-aware handling, so markup is preserved instead of being sent and translated as plain text.
- 3.5.4: Fixed Structured Text translation — content blocks nested inside Structured Text fields now translate correctly.
- 3.5.3: Internal: structured request/response debug logging across all providers (OpenAI, Anthropic, Gemini, DeepL), making translation issues easier to diagnose when debugging is enabled.
- 3.5.2: Internal: simplified the translation sidebar component and reworked the debug logger; no change to translation behavior.
- 3.5.1: Fixed translation cancellation and completion reliability. Cancelling a bulk or multi-record run now actually stops it instead of continuing in the background; the progress dialog's Close button no longer stays stuck on "Please wait…" when fewer records come back than were selected; and the single-record sidebar surfaces a clean "cancelled" state instead of an error.
- 3.5.0: Bulk and multi-record translation UX overhaul (select individual models and fields to translate). Also improved Dark Mode support.
- 3.4.6: Fix for SEO "Translate to all locales" functionality setting wrong result-language pairs.
- 3.4.2: Fix for optional & empty localized fields not getting correctly copied to new locales. Empty optional fields will now be null in the new locale, while required fields that cannot be translated will be a direct copy of the source locale's value.
- 3.4.1: Fixed several DeepL bugs from 3.4.0: glossary loading no longer races on duplicate fetches, error detection survives DeepL rewording their messages, and glossary caches now reset when you change API keys. Also fixed a latent bug where empty AI responses crashed translations instead of falling back to the original text.
- 3.4.0: Added better error handling for the CORS proxy and DeepL-specific configuration UI improvements. Selecting a glossary to use should be easier now.
- Prior to 3.4.0: No changelog was kept.
