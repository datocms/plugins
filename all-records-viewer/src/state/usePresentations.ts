import { useEffect, useRef, useState } from 'react';
import type {
  ItemPresentation,
  PresentationResolver,
} from '../presentation/resolver';
import type { RawItem } from '../types';

type PresentationState = {
  byItemId: ReadonlyMap<string, ItemPresentation>;
  loading: boolean;
};

export function usePresentations(
  resolver: PresentationResolver | null,
  items: readonly RawItem[],
): PresentationState {
  const [state, setState] = useState<PresentationState>({
    byItemId: new Map(),
    loading: false,
  });
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    if (!resolver || items.length === 0) {
      setState({ byItemId: new Map(), loading: false });
      return;
    }

    resolver.primeItems(items);
    setState((current) => ({ ...current, loading: true }));

    void resolver
      .resolveMany(items)
      .then((presentations) => {
        if (requestSequence.current !== sequence) {
          return;
        }

        setState({
          byItemId: new Map(
            items.map((item, index) => [item.id, presentations[index]]),
          ),
          loading: false,
        });
      })
      .catch(() => {
        if (requestSequence.current !== sequence) {
          return;
        }

        setState({ byItemId: new Map(), loading: false });
      });

    return () => {
      if (requestSequence.current === sequence) {
        requestSequence.current += 1;
      }
    };
  }, [items, resolver]);

  return state;
}
