import type { Client } from '@datocms/cma-client-browser';
import { useEffect, useState } from 'react';
import { normalizeError } from '../data/errors';
import { loadItemsById } from '../data/loadById';
import type { RawItem } from '../types';

export function useSelectedItemsPage(
  client: Client | null,
  selectedPage: readonly RawItem[],
  enabled: boolean,
  refreshVersion: number,
) {
  const [state, setState] = useState<{
    items: readonly RawItem[];
    loading: boolean;
    error: string | null;
  }>({ items: [], loading: false, error: null });
  useEffect(() => {
    void refreshVersion;
    let active = true;
    if (!enabled || !client) {
      setState({ items: [], loading: false, error: null });
      return;
    }
    setState({ items: [], loading: true, error: null });
    void loadItemsById(
      client,
      selectedPage.map((item) => item.id),
    )
      .then((items) => {
        if (!active) return;
        const byId = new Map(items.map((item) => [item.id, item]));
        setState({
          // Missing/deleted records remain selected but are not presented as current.
          items: selectedPage.flatMap((item) => {
            const loaded = byId.get(item.id);
            return loaded ? [loaded] : [];
          }),
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            items: [],
            loading: false,
            error: normalizeError(error).message,
          });
      });
    return () => {
      active = false;
    };
  }, [client, selectedPage, enabled, refreshVersion]);
  return state;
}
