import { ApiError, TimeoutError } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import type { BootView, FindReplaceController } from '../findReplace/contract';
import { createFindReplaceController } from '../findReplace/createFindReplaceController';
import { devHooks } from '../findReplace/devHooks';
import { FindReplaceApp } from '../findReplace/ui/FindReplaceApp';
import { stableSerialize } from '../selection/identity';
import { fetchRecordTotal } from '../selection/query';
import { loadSchemaIndex } from '../selection/schemaIndex';
import { buildCmaClient } from '../utils/cma';
import { readPluginParameters } from '../utils/parameters';
import {
  buildPermissionView,
  canPublishModel,
  isRoleAllowed,
} from '../utils/permissions';
import { loadModels, loadSiteLocales } from '../utils/schema';

type Props = {
  ctx: RenderPageCtx;
};

/** Boot results the page can show (the controller comes with `ready`). */
type BootResult =
  | { status: 'unavailable'; cause: 'role' | 'no_models' | 'token' }
  | { status: 'ready'; controller: FindReplaceController };

/** Errors map to causes, never to text: the page shows its own copy. */
function bootErrorCause(error: unknown): 'network' | 'unknown' {
  return error instanceof ApiError ||
    error instanceof TimeoutError ||
    error instanceof TypeError
    ? 'network'
    : 'unknown';
}

/**
 * Only these change what the page can do. Theme switches and every other host
 * update give a new ctx object with equal primitives, and must not reboot the
 * page (a running search or replacement keeps going).
 */
function bootKeyOf(ctx: RenderPageCtx, reloadKey: number): string {
  return [
    ctx.environment,
    ctx.currentRole.id,
    stableSerialize(ctx.currentRole.meta.final_permissions),
    stableSerialize(ctx.plugin.attributes.parameters),
    ctx.currentUserAccessToken ?? '',
    ctx.cmaBaseUrl,
    reloadKey,
  ].join('|');
}

/**
 * Loads models, locales, permissions, the schema and how many records the
 * models hold, then creates the controller. Resolves null when
 * `isCancelled()` turned true on the way.
 */
async function bootController(
  ctx: RenderPageCtx,
  isCancelled: () => boolean,
): Promise<BootResult | null> {
  const client = buildCmaClient(ctx);
  const [allModels, locales] = await Promise.all([
    loadModels(client),
    loadSiteLocales(client),
  ]);
  if (isCancelled()) return null;

  const permissionView = buildPermissionView({
    role: ctx.currentRole,
    environment: ctx.environment,
    params: readPluginParameters(ctx.plugin.attributes.parameters),
    tokenAvailable: true,
    models: allModels,
  });
  const models = allModels.filter((model) =>
    permissionView.allowedModelIds.has(model.id),
  );
  if (models.length === 0) {
    return { status: 'unavailable', cause: 'no_models' };
  }

  const modelIds = models.map((model) => model.id);
  const [schema, recordCount] = await Promise.all([
    loadSchemaIndex(client, { rootModelIds: modelIds }),
    // It only decides whether searches start on Enter: never fails the boot.
    fetchRecordTotal(client, modelIds).catch(() => null),
  ]);
  if (isCancelled()) return null;

  const publishableModelIds = new Set(
    models
      .filter((model) =>
        canPublishModel(ctx.currentRole, ctx.environment, model),
      )
      .map((model) => model.id),
  );

  const controller = createFindReplaceController({
    client,
    schema,
    siteId: ctx.site.id,
    environment: ctx.environment,
    locales,
    links: {
      internalDomain: ctx.site.attributes.internal_domain ?? null,
      isEnvironmentPrimary: ctx.isEnvironmentPrimary,
    },
    canPublishModel: (modelId) => publishableModelIds.has(modelId),
    recordCount,
  });
  return { status: 'ready', controller };
}

/** The early exits that need no request. */
function unavailableWithoutRequest(ctx: RenderPageCtx): BootView | null {
  if (!ctx.currentUserAccessToken) {
    return { status: 'unavailable', cause: 'token' };
  }
  const params = readPluginParameters(ctx.plugin.attributes.parameters);
  if (!isRoleAllowed(params, ctx.currentRole.id)) {
    return { status: 'unavailable', cause: 'role' };
  }
  return null;
}

/**
 * Boots the page for one boot key. Returns the cleanup: it cancels a boot in
 * progress and disposes the controller it created.
 */
function startBoot(
  ctx: RenderPageCtx,
  setBoot: (boot: BootView) => void,
  retry: () => void,
): () => void {
  const unavailable = unavailableWithoutRequest(ctx);
  if (unavailable) {
    setBoot(unavailable);
    return () => {};
  }

  let cancelled = false;
  let controller: FindReplaceController | null = null;
  setBoot({ status: 'booting' });
  bootController(ctx, () => cancelled).then(
    (result) => {
      if (!result) return;
      if (cancelled) {
        if (result.status === 'ready') result.controller.dispose();
        return;
      }
      if (result.status === 'ready') {
        controller = result.controller;
        if (import.meta.env.DEV) devHooks.onController?.(controller);
      }
      setBoot(result);
    },
    (error: unknown) => {
      if (!cancelled) {
        setBoot({ status: 'failed', cause: bootErrorCause(error), retry });
      }
    },
  );

  return () => {
    cancelled = true;
    controller?.dispose();
  };
}

export default function FindReplacePage({ ctx }: Props) {
  // The boot effect reads the latest ctx through this ref.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const [reloadKey, setReloadKey] = useState(0);
  const [boot, setBoot] = useState<BootView>({ status: 'booting' });
  const bootKey = bootKeyOf(ctx, reloadKey);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bootKey` holds every ctx primitive the boot depends on; the latest ctx is read through the ref, so other host updates never reboot the page.
  useEffect(
    () =>
      startBoot(ctxRef.current, setBoot, () =>
        setReloadKey((value) => value + 1),
      ),
    [bootKey],
  );

  return <FindReplaceApp ctx={ctx} boot={boot} />;
}
