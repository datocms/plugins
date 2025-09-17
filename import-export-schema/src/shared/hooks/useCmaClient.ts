import { useMemo } from 'react';
import type { Client, ClientConfigOptions } from '@datocms/cma-client';
import type {
  RenderConfigScreenCtx,
  RenderPageCtx,
} from 'datocms-plugin-sdk';
import { createCmaClient } from '@/utils/createCmaClient';

type AuthCtx =
  | Pick<RenderPageCtx, 'currentUserAccessToken' | 'environment'>
  | Pick<RenderConfigScreenCtx, 'currentUserAccessToken' | 'environment'>;

type UseCmaClientOptions = {
  overrides?: Partial<ClientConfigOptions>;
};

/**
 * Returns a memoized CMA client that only changes when auth info changes.
 * Consumers should keep `overrides` stable to avoid needless re-instantiation.
 */
export function useCmaClient(
  ctx: AuthCtx,
  { overrides }: UseCmaClientOptions = {},
): Client {
  return useMemo(
    () => createCmaClient(ctx, overrides),
    [ctx.currentUserAccessToken, ctx.environment, overrides],
  );
}
