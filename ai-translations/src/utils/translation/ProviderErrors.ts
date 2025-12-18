/**
 * Canonical error shape used across providers to surface actionable messages
 * and hints to the UI.
 */
export type NormalizedProviderError = {
  code: 'auth' | 'quota' | 'rate_limit' | 'model' | 'network' | 'unknown';
  message: string;
  hint?: string;
};

/**
 * Case-insensitive substring check helper.
 *
 * @param s - String to inspect.
 * @param needles - One or more substrings to search for.
 * @returns True if any needle is found within `s` (case-insensitive).
 */
const includes = (s: unknown, ...needles: string[]) =>
  typeof s === 'string' && needles.some((n) => s.toLowerCase().includes(n.toLowerCase()));

/**
 * Normalizes provider-specific errors to a compact, user-friendly shape, with
 * special handling for common authentication, quota, rate-limit and model
 * errors. Includes targeted hints where we can determine a likely fix.
 *
 * @param err - Raw error thrown from a provider client or fetch call.
 * @param vendor - Provider id for vendor-specific mappings.
 * @returns A normalized error with `code`, `message`, and optional `hint`.
 */
export function normalizeProviderError(err: unknown, vendor: 'openai' | 'google' | 'anthropic' | 'deepl'): NormalizedProviderError {
  const anyErr = err as any;
  const status = anyErr?.status || anyErr?.code || anyErr?.response?.status;
  const rawMessage = String(anyErr?.message || anyErr?.error?.message || anyErr || 'Unknown error');
  const message = rawMessage;

  // Special OpenAI streaming verification failure
  if (
    vendor === 'openai' &&
    (anyErr?.error?.code === 'unsupported_value' || status === 400) &&
    (anyErr?.error?.param === 'stream' || includes(message, 'stream')) &&
    includes(message, 'must be verified to stream this model')
  ) {
    return {
      code: 'auth',
      message,
      hint: 'Verify your organization in OpenAI or choose a different model.',
    };
  }

  // Common mappings
  if (status === 401 || includes(message, 'unauthorized', 'invalid api key', 'invalid authentication', 'not valid api key', 'permission_denied')) {
    return {
      code: 'auth',
      message: 'Authentication failed for the selected AI vendor.',
      hint: vendor === 'openai'
        ? 'Check OpenAI API key and organization access in settings.'
        : 'Check Google API key and that Generative Language API is enabled.',
    };
  }

  if (status === 429 || includes(message, 'rate limit', 'too many requests')) {
    return {
      code: 'rate_limit',
      message: 'Rate limit reached. Please wait and try again.',
      hint: vendor === 'openai'
        ? 'Reduce concurrency, switch to a more available model, or increase limits.'
        : vendor === 'google'
        ? 'Reduce request rate or increase quota in Google Cloud console.'
        : vendor === 'anthropic'
        ? 'Reduce request rate or increase Anthropic rate limits.'
        : 'Reduce concurrency or batch size; check DeepL plan limits.',
    };
  }

  if (includes(message, 'insufficient_quota', 'quota exceeded', 'resource has been exhausted', 'out of quota')) {
    return {
      code: 'quota',
      message: 'Quota exceeded for the selected AI vendor.',
      hint: vendor === 'openai'
        ? 'Check OpenAI usage and billing; switch to a smaller model if needed.'
        : vendor === 'google'
        ? 'Verify Google project quotas and billing for Generative Language API.'
        : vendor === 'anthropic'
        ? 'Check Anthropic usage limits and billing.'
        : 'Check DeepL usage limits and plan.',
    };
  }

  if (status === 404 || includes(message, 'model not found', 'no such model', 'unsupported model', 'not found: model')) {
    return {
      code: 'model',
      message: 'The selected model is unavailable or not accessible.',
      hint: vendor === 'openai'
        ? 'Ensure the model exists on your account and is spelled correctly.'
        : vendor === 'google'
        ? 'Ensure the Gemini model id is correct and available in your region.'
        : vendor === 'anthropic'
        ? 'Ensure the Claude model id is correct and you have access.'
        : 'Ensure the language pair is valid for DeepL; check target code.',
    };
  }

  if (includes(message, 'failed to fetch', 'fetch failed', 'network', 'ecconn', 'enotfound', 'timeout')) {
    return {
      code: 'network',
      message: rawMessage,
      hint: 'This often indicates CORS/proxy issues or connectivity problems.',
    };
  }

  // DeepL specific: wrong endpoint (free vs pro)
  if (vendor === 'deepl' && (status === 403 || includes(message, 'wrong endpoint'))) {
    return {
      code: 'auth',
      message: 'DeepL: wrong endpoint for your API key. If your key ends with :fx, enable "Use DeepL Free endpoint (api-free.deepl.com)" in Settings. Otherwise, disable it to use api.deepl.com.',
      hint: 'Match the endpoint to your plan: Free (:fx) → api-free.deepl.com; Pro → api.deepl.com.',
    };
  }

  return {
    code: 'unknown',
    message,
  };
}
