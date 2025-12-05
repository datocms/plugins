import type {
  RenderItemFormSidebarCtx,
  RenderItemFormSidebarPanelCtx,
} from 'datocms-plugin-sdk';
import { useState } from 'react';
import {
  useDeepCompareCallback,
  useDeepCompareEffect,
  useDeepCompareMemo,
} from 'use-deep-compare';
import {
  type Frontend,
  type Parameters,
  type PreviewLink,
  type Response,
  isValidResponse,
  normalizeParameters,
} from '../types';
export type FrontendStatus = { previewLinks: PreviewLink[] } | { error: any };

export async function makeRequest(
  { previewWebhook, name, customHeaders }: Frontend,
  payload: string,
): Promise<[string, FrontendStatus]> {
  try {
    if (!previewWebhook) {
      throw new Error(`Missing "Preview Webhook URL" option!`);
    }

    const url = new URL(previewWebhook);

    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const { name, value } of customHeaders) {
      headers.set(name, value);
    }

    const request = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: payload,
    });

    if (request.status !== 200) {
      throw new Error(
        `[Web Previews] Webhook for frontend "${name}" returned a ${request.status} status!`,
      );
    }

    const response: Response = await request.json();

    if (!isValidResponse(response)) {
      throw new Error(
        `[Web Previews] Webhook for frontend "${name}" returned an invalid payload!`,
      );
    }

    return [name, { previewLinks: response.previewLinks }];
  } catch (error) {
    return [name, { error }];
  }
}

export function useStatusByFrontend(
  ctx: RenderItemFormSidebarCtx | RenderItemFormSidebarPanelCtx,
) {
  const [statusByFrontend, setStatusByFrontend] = useState<
    Record<string, FrontendStatus | undefined> | undefined
  >();

  const { frontends: rawFrontends } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const frontends = rawFrontends.filter((f) => !f.disabled);

  const {
    item,
    locale,
    itemType,
    environment: environmentId,
    currentUser,
  } = ctx;

  const payloadBody = useDeepCompareMemo(
    () =>
      item
        ? JSON.stringify(
            {
              item,
              itemType,
              environmentId,
              locale,
              currentUser,
            },
            null,
            2,
          )
        : undefined,
    [environmentId, item, itemType, locale, currentUser],
  );

  const run = useDeepCompareCallback(
    async (frontends: Frontend[]) => {
      if (!payloadBody) {
        setStatusByFrontend(
          Object.fromEntries(
            frontends.map((frontend) => [frontend.name, { previewLinks: [] }]),
          ),
        );
        return;
      }

      const results = await Promise.all(
        frontends.map((frontend) => makeRequest(frontend, payloadBody)),
      );

      setStatusByFrontend(Object.fromEntries(results));
    },
    [payloadBody],
  );

  useDeepCompareEffect(() => {
    run(frontends);
  }, [run, frontends]);

  return [frontends, statusByFrontend] as const;
}
