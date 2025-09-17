import { useMemo } from 'react';
import type { Client, ClientConfigOptions } from '@datocms/cma-client';
import type {
  RenderConfigScreenCtx,
  RenderPageCtx,
} from 'datocms-plugin-sdk';
import { ProjectSchema } from '@/utils/ProjectSchema';
import { useCmaClient } from './useCmaClient';

type AuthCtx =
  | Pick<RenderPageCtx, 'currentUserAccessToken' | 'environment'>
  | Pick<RenderConfigScreenCtx, 'currentUserAccessToken' | 'environment'>;

type UseProjectSchemaOptions = {
  clientOverrides?: Partial<ClientConfigOptions>;
  existingClient?: Client;
};

/**
 * Provides a memoized ProjectSchema instance keyed by CMA client identity.
 * If `existingClient` is passed, the hook will wrap that client instead of
 * creating a new one. The resulting schema caches API calls internally, so
 * sharing the instance across the component tree avoids redundant requests.
 */
export function useProjectSchema(
  ctx: AuthCtx,
  options: UseProjectSchemaOptions = {},
): ProjectSchema {
  const resolvedClient = useCmaClient(ctx, {
    overrides: options.clientOverrides,
  });

  const targetClient = options.existingClient ?? resolvedClient;

  return useMemo(() => new ProjectSchema(targetClient), [targetClient]);
}
