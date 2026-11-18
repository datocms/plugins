import type { ResolvedItemPresentationInfo } from 'datocms-plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import type { RawItem } from '../types';

/** The presentations of some records, in their order: `ctx.loadItemPresentationInfo` */
export type LoadPresentations = (
  items: RawItem[],
) => Promise<Array<ResolvedItemPresentationInfo | null>>;

type PresentationState = {
  byItemId: ReadonlyMap<string, ResolvedItemPresentationInfo>;
  loading: boolean;
};

/**
 * The title and the image of the records of the page, as DatoCMS shows them,
 * in one call for the page. While the next page loads, the records that stay
 * keep their presentation.
 */
export function usePresentations(
  load: LoadPresentations,
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

    if (items.length === 0) {
      setState({ byItemId: new Map(), loading: false });
      return;
    }

    const visibleIds = new Set(items.map((item) => item.id));
    setState((current) => ({
      byItemId: new Map(
        [...current.byItemId].filter(([id]) => visibleIds.has(id)),
      ),
      loading: true,
    }));

    void load([...items])
      .then((presentations) => {
        if (requestSequence.current !== sequence) {
          return;
        }

        const byItemId = new Map<string, ResolvedItemPresentationInfo>();
        for (const [index, item] of items.entries()) {
          const presentation = presentations[index];
          if (presentation) byItemId.set(item.id, presentation);
        }
        setState({ byItemId, loading: false });
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
  }, [items, load]);

  return state;
}
