/**
 * useDeepLGlossaries.ts
 * Hook that fetches and caches the user's DeepL glossaries.
 * Shared between the default glossary selector and the per-pair editor.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const CORS_PROXY = 'https://cors-proxy.datocms.com';

/** Shape of a single glossary returned by the DeepL list-glossaries API. */
export interface DeepLGlossary {
  glossary_id: string;
  name: string;
  ready: boolean;
  source_lang: string;
  target_lang: string;
  entry_count: number;
}

export type GlossaryFetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseDeepLGlossariesResult {
  glossaries: DeepLGlossary[];
  fetchStatus: GlossaryFetchStatus;
  fetchError: string;
  refetch: () => void;
}

/** Discriminated result of a single glossary-list fetch attempt. */
type FetchGlossariesResult =
  | { kind: 'success'; glossaries: DeepLGlossary[] }
  | { kind: 'error'; message: string };

/**
 * Performs a single GET against the DeepL list-glossaries endpoint via the
 * DatoCMS CORS proxy and classifies the response into a success/error union.
 *
 * Lives outside the hook so the hook itself stays a thin orchestrator and the
 * branchy validation logic doesn't blow up the hook's cognitive complexity.
 *
 * Note: the CORS proxy may relay DeepL errors with HTTP 200, so we inspect
 * the parsed body for an error `message` field BEFORE trusting `res.ok`.
 */
async function fetchDeepLGlossariesList(
  deeplApiKey: string,
  deeplUseFree: boolean,
): Promise<FetchGlossariesResult> {
  const baseUrl = deeplUseFree
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';
  const deeplApiUrl = `${baseUrl}/v2/glossaries`;
  const url = `${CORS_PROXY}/?url=${encodeURIComponent(deeplApiUrl)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `DeepL-Auth-Key ${deeplApiKey}`,
    },
  });

  const json: unknown = await res.json();
  const responseObject =
    json && typeof json === 'object' ? (json as Record<string, unknown>) : null;

  // Proxy-relayed DeepL error (often arrives with HTTP 200)
  if (responseObject && typeof responseObject.message === 'string') {
    return {
      kind: 'error',
      message: `Could not load glossaries: ${responseObject.message}`,
    };
  }

  // Real HTTP failure with no body message
  if (!res.ok) {
    return {
      kind: 'error',
      message: `Could not load glossaries (HTTP ${res.status}). Check your API key.`,
    };
  }

  // Unexpected success-shape: no glossaries array on the body
  if (!responseObject || !Array.isArray(responseObject.glossaries)) {
    return {
      kind: 'error',
      message: 'Unexpected response from DeepL glossaries endpoint.',
    };
  }

  const list = (responseObject.glossaries as DeepLGlossary[]).filter(
    (g) => g.ready,
  );
  return { kind: 'success', glossaries: list };
}

export function useDeepLGlossaries(
  deeplApiKey: string,
  deeplUseFree: boolean,
): UseDeepLGlossariesResult {
  const [glossaries, setGlossaries] = useState<DeepLGlossary[]>([]);
  const [fetchStatus, setFetchStatus] = useState<GlossaryFetchStatus>('idle');
  const [fetchError, setFetchError] = useState('');
  const lastFetchKey = useRef('');
  // Tracks the cacheKey of an in-flight fetch so a re-render cannot kick off
  // a duplicate concurrent request before the first one resolves.
  const inFlightKey = useRef<string | null>(null);

  const fetchGlossaries = useCallback(async () => {
    if (!deeplApiKey) {
      setGlossaries([]);
      setFetchStatus('idle');
      return;
    }

    const cacheKey = `${deeplApiKey}:${deeplUseFree}`;
    // Bail if we already succeeded for this key (lastFetchKey is reset to ''
    // on every error path below, so failed attempts can still retry) or if a
    // fetch for this exact key is already in flight.
    const alreadySucceeded = cacheKey === lastFetchKey.current;
    const alreadyInFlight = cacheKey === inFlightKey.current;
    if (alreadySucceeded || alreadyInFlight) return;

    inFlightKey.current = cacheKey;
    setFetchStatus('loading');
    setFetchError('');

    try {
      const result = await fetchDeepLGlossariesList(deeplApiKey, deeplUseFree);
      if (result.kind === 'success') {
        setGlossaries(result.glossaries);
        setFetchStatus('success');
        lastFetchKey.current = cacheKey;
      } else {
        setGlossaries([]);
        setFetchStatus('error');
        setFetchError(result.message);
        lastFetchKey.current = '';
      }
    } catch (err) {
      setGlossaries([]);
      setFetchStatus('error');
      setFetchError(
        err instanceof Error ? err.message : 'Failed to fetch glossaries.',
      );
      lastFetchKey.current = '';
    } finally {
      inFlightKey.current = null;
    }
  }, [deeplApiKey, deeplUseFree]);

  // Auto-fetch when API key or endpoint changes
  useEffect(() => {
    const cacheKey = `${deeplApiKey}:${deeplUseFree}`;
    if (deeplApiKey && cacheKey !== lastFetchKey.current) {
      fetchGlossaries();
    }
  }, [deeplApiKey, deeplUseFree, fetchGlossaries]);

  return { glossaries, fetchStatus, fetchError, refetch: fetchGlossaries };
}
