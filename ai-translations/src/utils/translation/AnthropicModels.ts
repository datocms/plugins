// Dynamic model listing for Anthropic (Claude)
// Docs: https://docs.anthropic.com/claude/reference/models_get

/**
 * Anthropic model metadata as returned by the Claude models API.
 * Only a subset is used for filtering and sorting in the UI.
 */
export type AnthropicModel = {
  id: string; // e.g., "claude-3.5-haiku-latest"
  type?: string;
};

function isRelevantClaude(id: string): boolean {
  const mid = id.toLowerCase();
  if (!mid.startsWith('claude')) return false;
  if (mid.includes('embed')) return false; // exclude embedding models if any
  return true;
}

function scoreClaude(id: string): number {
  const mid = id.toLowerCase();
  let score = 0;
  if (mid.includes('3.5')) score += 1000;
  if (mid.includes('haiku')) score += 100; // fastest / cost‑effective
  if (mid.includes('sonnet')) score += 60; // higher quality
  if (mid.includes('opus')) score += 20;   // heavyweight
  if (mid.endsWith('-latest')) score += 30;
  return score;
}

/**
 * Lists relevant Claude models for text generation, excluding embeddings and
 * ranking them by recency/latency/quality heuristics. Falls back to a small
 * curated list when the API request fails (offline, bad key, etc.).
 *
 * @param apiKey - Anthropic API key used to query the models endpoint.
 * @returns Sorted list of model ids (e.g. "claude-3.5-haiku-latest").
 */
export async function listRelevantAnthropicModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const data: AnthropicModel[] = Array.isArray(json?.data) ? json.data : [];
    const ids = data.map((m) => m.id).filter((id) => typeof id === 'string' && isRelevantClaude(id));
    const uniq = Array.from(new Set(ids));
    return uniq.sort((a, b) => {
      const s = scoreClaude(b) - scoreClaude(a);
      return s !== 0 ? s : a.localeCompare(b);
    });
  } catch {
    // Sensible fallback if listing fails
    return ['claude-3.5-haiku-latest', 'claude-3.5-sonnet-latest'];
  }
}
