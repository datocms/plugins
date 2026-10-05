import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCmaClient } from '../lib/cma';
import type { StageMenuItem } from '../types';
import { loadStage, type StageData } from './loadStage';

export type StageDataState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; data: StageData; refreshing: boolean };

/**
 * Loads the stage's records once per page and environment. `reload()` keeps
 * the current rows on screen while it refetches.
 */
export function useStageData(
  ctx: RenderPageCtx,
  menuItem: StageMenuItem | null,
): { state: StageDataState; reload: () => void } {
  const [state, setState] = useState<StageDataState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  // The host sends a new ctx on every change; read the latest one when loading
  // instead of reloading on each of them.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const workflowId = menuItem?.workflowId;
  const stageId = menuItem?.stageId;
  const environment = ctx.environment;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken and environment are reload triggers
  useEffect(() => {
    if (!workflowId || !stageId) return;

    const controller = new AbortController();
    setState((current) =>
      current.status === 'ready'
        ? { ...current, refreshing: true }
        : { status: 'loading' },
    );

    const run = async () => {
      try {
        const latest = ctxRef.current;
        const data = await loadStage(
          {
            client: buildCmaClient(latest, controller.signal),
            // The loader retries a slow page smaller itself, so the
            // transport shouldn't repeat it at the same size first.
            pageClient: buildCmaClient(latest, controller.signal, {
              retryTimeouts: false,
            }),
            itemTypes: latest.itemTypes,
            locales: latest.site.attributes.locales,
            timeZone: latest.site.attributes.timezone ?? undefined,
            loadItemTypeFields: latest.loadItemTypeFields,
          },
          { workflowId, stageId },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setState({ status: 'ready', data, refreshing: false });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ status: 'error', error });
          // Cancel whatever the failed load still has queued or in flight.
          controller.abort();
        }
      }
    };
    void run();

    return () => controller.abort();
  }, [workflowId, stageId, environment, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { state, reload };
}
