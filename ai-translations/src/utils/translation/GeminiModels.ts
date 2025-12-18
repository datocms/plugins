// Fetch and filter relevant Gemini models for text generation
// Docs: https://generativelanguage.googleapis.com

/**
 * Partial representation of a Gemini model entry from the API.
 */
export type GeminiModelInfo = {
  name: string; // e.g., "models/gemini-1.5-flash"
  displayName?: string;
  supportedGenerationMethods?: string[];
};

function stripPrefix(id: string): string {
  return id.startsWith('models/') ? id.slice('models/'.length) : id;
}

function isRelevantGeminiModel(m: GeminiModelInfo): boolean {
  const id = stripPrefix(m.name).toLowerCase();
  if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) {
    return false;
  }
  // Exclude embeddings and text-only utility models
  const excluded = ['embedding', 'embed', 'text-embedding', 'moderation'];
  if (excluded.some((kw) => id.includes(kw))) return false;
  return /^(gemini-)/.test(id);
}

function scoreGemini(id: string): number {
  const mid = id.toLowerCase();
  let base = 0;
  if (/^gemini-2\.5/.test(mid)) base = 1200;
  else if (/^gemini-2\.0/.test(mid)) base = 900;
  else if (/^gemini-1\.5/.test(mid)) base = 700;
  else if (/^gemini-1\.0/.test(mid)) base = 500;
  // Prefer flash a bit for cost/latency, then pro for quality
  if (mid.includes('flash')) base += 20;
  if (mid.includes('pro')) base += 10;
  return base;
}

/**
 * Lists Gemini models that support text generation, excluding embeddings and
 * utility models, and sorts them by rough capability/speed heuristics.
 * Falls back to a minimal curated list when the request fails.
 *
 * @param apiKey - Google API key for Generative Language API.
 * @returns Sorted list of model ids without the `models/` prefix.
 */
export async function listRelevantGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'x-goog-api-key': apiKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to list Gemini models (${res.status})`);
    }
    const json = await res.json();
    const models: GeminiModelInfo[] = Array.isArray(json.models) ? json.models : [];
    const ids = models
      .filter(isRelevantGeminiModel)
      .map((m) => stripPrefix(m.name));
    const sorted = ids
      .sort((a, b) => {
        const s = scoreGemini(b) - scoreGemini(a);
        return s !== 0 ? s : a.localeCompare(b);
      })
      .filter((id, idx, arr) => arr.indexOf(id) === idx);
    return sorted;
  } catch (_e) {
    // Fall back to a minimal list when listing fails
    return ['gemini-1.5-flash', 'gemini-1.5-pro'];
  }
}
