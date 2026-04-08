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

export function useDeepLGlossaries(
  deeplApiKey: string,
  deeplUseFree: boolean,
): UseDeepLGlossariesResult {
  const [glossaries, setGlossaries] = useState<DeepLGlossary[]>([]);
  const [fetchStatus, setFetchStatus] = useState<GlossaryFetchStatus>('idle');
  const [fetchError, setFetchError] = useState('');
  const lastFetchKey = useRef('');

  const fetchGlossaries = useCallback(async () => {
    if (!deeplApiKey) {
      setGlossaries([]);
      setFetchStatus('idle');
      return;
    }

    const cacheKey = `${deeplApiKey}:${deeplUseFree}`;
    if (cacheKey === lastFetchKey.current && fetchStatus === 'success') return;

    setFetchStatus('loading');
    setFetchError('');

    try {
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

      if (
        json &&
        typeof json === 'object' &&
        typeof (json as Record<string, unknown>).message === 'string'
      ) {
        setFetchStatus('error');
        setFetchError(
          `Could not load glossaries: ${(json as Record<string, unknown>).message}`,
        );
        setGlossaries([]);
        lastFetchKey.current = '';
        return;
      }

      if (!res.ok) {
        setFetchStatus('error');
        setFetchError(
          `Could not load glossaries (HTTP ${res.status}). Check your API key.`,
        );
        setGlossaries([]);
        lastFetchKey.current = '';
        return;
      }

      const body = json as Record<string, unknown>;
      if (!Array.isArray(body.glossaries)) {
        setFetchStatus('error');
        setFetchError('Unexpected response from DeepL glossaries endpoint.');
        setGlossaries([]);
        lastFetchKey.current = '';
        return;
      }

      const list = (body.glossaries as DeepLGlossary[]).filter((g) => g.ready);
      setGlossaries(list);
      setFetchStatus('success');
      lastFetchKey.current = cacheKey;
    } catch (err) {
      setFetchStatus('error');
      setFetchError(
        err instanceof Error ? err.message : 'Failed to fetch glossaries.',
      );
      setGlossaries([]);
      lastFetchKey.current = '';
    }
  }, [deeplApiKey, deeplUseFree, fetchStatus]);

  // Auto-fetch when API key or endpoint changes
  useEffect(() => {
    const cacheKey = `${deeplApiKey}:${deeplUseFree}`;
    if (deeplApiKey && cacheKey !== lastFetchKey.current) {
      fetchGlossaries();
    }
  }, [deeplApiKey, deeplUseFree, fetchGlossaries]);

  return { glossaries, fetchStatus, fetchError, refetch: fetchGlossaries };
}
