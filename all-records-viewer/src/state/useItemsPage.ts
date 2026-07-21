import type { Client } from '@datocms/cma-client-browser';
import { useEffect, useRef, useState } from 'react';
import { normalizeError } from '../data/errors';
import {
  fetchPartitionedItemsPage,
  shouldUsePartitionedOrdering,
} from '../data/partitionedOrdering';
import { fetchItemsPage } from '../data/query';
import type { ModelSummary, QueryState, RawItem } from '../types';

type ItemsPageState = {
  items: RawItem[];
  totalCount: number;
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

const EMPTY_STATE: ItemsPageState = {
  items: [],
  totalCount: 0,
  loading: false,
  loaded: false,
  error: null,
};

export function useItemsPage(args: {
  client: Client | null;
  queryState: QueryState;
  enabled: boolean;
  refreshVersion: number;
  schemaVersion?: string;
  serverOrderBy?: string;
  models?: readonly ModelSummary[];
}): ItemsPageState {
  const [state, setState] = useState<ItemsPageState>(EMPTY_STATE);
  const requestSequence = useRef(0);

  useEffect(() => {
    void args.refreshVersion;
    void args.schemaVersion;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    if (!args.enabled || !args.client) {
      setState(EMPTY_STATE);
      return;
    }

    setState((current) => ({
      ...current,
      loading: true,
      loaded: false,
      error: null,
    }));

    const request = shouldUsePartitionedOrdering(args.queryState)
      ? fetchPartitionedItemsPage({
          client: args.client,
          state: args.queryState,
          models: args.models ?? [],
        })
      : fetchItemsPage(args.client, args.queryState, args.serverOrderBy);

    void request
      .then((result) => {
        if (requestSequence.current !== sequence) {
          return;
        }

        setState({
          items: result.items,
          totalCount: result.totalCount,
          loading: false,
          loaded: true,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (requestSequence.current !== sequence) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false,
          loaded: false,
          error: normalizeError(error).message,
        }));
      });

    return () => {
      if (requestSequence.current === sequence) {
        requestSequence.current += 1;
      }
    };
  }, [
    args.client,
    args.enabled,
    args.queryState,
    args.models,
    args.refreshVersion,
    args.schemaVersion,
    args.serverOrderBy,
  ]);

  return state;
}
