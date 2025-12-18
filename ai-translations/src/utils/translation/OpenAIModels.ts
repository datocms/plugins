import OpenAI from 'openai';

/**
 * Returns a relevance score for a model id for translation via Chat Completions.
 * Higher score means more preferred. This is a heuristic that prefers
 * general-purpose GPT-4.x chat models and de-prioritizes mini/nano variants.
 *
 * @param id - Candidate model identifier.
 * @returns Numeric score representing preference weight.
 */
function modelScore(id: string): number {
  const mid = id.toLowerCase();
  const isMini = /(^|[.-])mini\b/.test(mid);
  const isNano = /(^|[.-])nano\b/.test(mid);

  let family = 0;
  if (/^gpt-5(\b|[.-])/.test(mid)) family = 900;
  else if (/^gpt-4\.1(\b|[.-])/.test(mid)) family = 500;
  else if (/^gpt-4o(\b|[.-])/.test(mid)) family = 450;
  else if (/^gpt-4-turbo(\b|[.-])/.test(mid)) family = 400;
  else if (/^gpt-4(\b|[.-])/.test(mid)) family = 350;
  else if (/^gpt-3\.5(\b|[.-])/.test(mid)) family = 150;
  else if (/^ft:gpt-/.test(mid)) family = 125;
  else family = 50;

  // Variant adjustments: prefer mini over base for cost/latency, nano below
  let score = family;
  if (isMini) score += 20;
  if (isNano) score -= 30;

  // Deprioritize special previews and reasoning-heavy profiles for translation
  if (/thinking|reasoning/.test(mid)) score -= 60;
  if (/preview/.test(mid)) score -= 10;
  return score;
}

/**
 * Determine if a model id is relevant for text translation using the Chat Completions API.
 * Excludes embeddings, audio, vision-only, moderation, realtime, and image models.
 *
 * @param id - Candidate model identifier.
 * @returns True when the model is a viable chat model for translation.
 */
export function isRelevantChatModel(id: string): boolean {
  const mid = id.toLowerCase();

  // Must be a GPT chat model (base or fine-tuned)
  const looksLikeChat = /^gpt-/.test(mid) || /^ft:gpt-/.test(mid);
  if (!looksLikeChat) return false;

  // Exclude obviously incompatible model families
  const excluded = [
    'whisper',
    'tts',
    'audio',
    'speech',
    'dall-e',
    'image',
    'omni-moderation',
    'moderation',
    'text-embedding',
    'embedding',
    'realtime',
    'vision',
  ];
  if (excluded.some((kw) => mid.includes(kw))) return false;

  return true;
}

/**
 * Fetch and return a sorted list of relevant OpenAI models for translation.
 * Sorting prefers quality/capability first, then variants (mini/nano), then name.
 *
 * @param apiKey - OpenAI API key used to list available models.
 * @returns Sorted array of relevant chat model identifiers.
 */
export async function listRelevantOpenAIModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  const { data } = await client.models.list();
  const allIds = data.map((m) => m.id);

  const relevant = allIds.filter(isRelevantChatModel);

  const sorted = relevant
    .sort((a, b) => {
      const s = modelScore(b) - modelScore(a); // higher score first
      return s !== 0 ? s : a.localeCompare(b);
    })
    // De-duplicate (API can sometimes surface aliases or fine-tune variants
    // that differ only by trivial suffixes; keep unique exact ids here)
    .filter((id, idx, arr) => arr.indexOf(id) === idx);

  return sorted;
}
