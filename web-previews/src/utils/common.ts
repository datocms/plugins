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
  frontend: Frontend,
  payload: string,
): Promise<[string, FrontendStatus]> {
  try {
    if (!frontend.previewLinks) {
      throw new Error(`Missing "Preview Links API endpoint" option!`);
    }

    const { apiEndpointUrl, customHeaders } = frontend.previewLinks;
    const url = new URL(apiEndpointUrl);
    const { hostname } = url;

    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const { name, value } of customHeaders) {
      headers.set(name, value);
    }

    const isLoopback: boolean =
      hostname === 'localhost' || hostname === '127.0.0.1';

    const request = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: payload,
      //@ts-expect-error targetAddressSpace is a Chromium thing
      // See https://github.com/WICG/local-network-access/blob/main/explainer.md
      targetAddressSpace: isLoopback ? 'local' : undefined, // e.g. localhost or 127.0.0.1
    });

    if (request.status !== 200) {
      throw new Error(
        `[Web Previews] API endpoint for frontend "${frontend.name}" returned a ${request.status} status!`,
      );
    }

    const response: Response = await request.json();

    if (!isValidResponse(response)) {
      throw new Error(
        `[Web Previews] API endpoint for frontend "${frontend.name}" returned an invalid payload!`,
      );
    }

    return [frontend.name, { previewLinks: response.previewLinks }];
  } catch (error) {
    return [frontend.name, { error }];
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

  const frontends = rawFrontends.filter((f) => !f.disabled && f.previewLinks);

  const {
    item,
    locale,
    itemType,
    environment: environmentId,
    currentUser,
    site: { id: siteId },
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
              siteId,
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
