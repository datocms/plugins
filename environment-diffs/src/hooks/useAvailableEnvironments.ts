import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import { createRootClient } from '../lib/datocms';

export function useAvailableEnvironments(ctx: RenderPageCtx) {
  const [environmentIds, setEnvironmentIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!ctx.currentUserAccessToken) {
        if (active) {
          setEnvironmentIds([]);
          setError('This plugin requires the currentUserAccessToken permission.');
          setIsLoading(false);
        }
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const client = createRootClient(ctx.currentUserAccessToken);
        const environments = await client.environments.list();
        const ids = environments
          .map((environment) => environment.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
          .sort((left, right) => left.localeCompare(right));

        if (active) {
          setEnvironmentIds(ids);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load environments.',
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [ctx.currentUserAccessToken]);

  return useMemo(
    () => ({
      environmentIds,
      isLoading,
      error,
      hasEnoughEnvironments: environmentIds.length >= 2,
    }),
    [environmentIds, error, isLoading],
  );
}
