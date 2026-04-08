# Changelog

- 3.4.1: Fixed several DeepL bugs from 3.4.0: glossary loading no longer races on duplicate fetches, error detection survives DeepL rewording their messages, and glossary caches now reset when you change API keys. Also fixed a latent bug where empty AI responses crashed translations instead of falling back to the original text.
- 3.4.0: Added better error handling for the CORS proxy and DeepL-specific configuration UI improvements. Selecting a glossary to use should be easier now.
- Prior to 3.4.0: No changelog was kept.
