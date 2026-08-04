import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import type { Frontend, PreviewLinkWithFrontend } from '../../types';
import {
  type EditUrlInfo,
  SYMBOL_FOR_PRIMARY_ENVIRONMENT,
} from '../../utils/contentLink/types';
import useContentLinkConnection from '../../utils/contentLink/useContentLinkConnection';

export type SidebarVisualEditingInfo = {
  iframeUrl: string;
  alreadyInDraftMode: boolean;
};

function safeRedirectPath(
  redirect: string,
  draftModeUrl: URL,
): string | undefined {
  const url = new URL(redirect, draftModeUrl.origin);

  if (url.origin !== draftModeUrl.origin) {
    return undefined;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Resolves any preview link belonging to a visual-editing frontend to a URL
 * that enables draft mode for the same page. Published preview links normally
 * point to a disable-draft-mode helper, so checking only for the configured
 * enable route would incorrectly reject fully published records.
 */
export function sidebarVisualEditingInfo(
  link: PreviewLinkWithFrontend | undefined,
  frontend: Frontend | undefined,
): SidebarVisualEditingInfo | undefined {
  const enableDraftModeUrl = frontend?.visualEditing?.enableDraftModeUrl;
  if (!link || !enableDraftModeUrl) {
    return undefined;
  }

  try {
    const previewUrl = new URL(link.url);
    const draftModeUrl = new URL(enableDraftModeUrl);
    const redirect = previewUrl.searchParams.get('redirect');

    const path = redirect
      ? safeRedirectPath(redirect, draftModeUrl)
      : previewUrl.origin === draftModeUrl.origin &&
          previewUrl.pathname !== draftModeUrl.pathname
        ? `${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`
        : undefined;

    if (!path) {
      return undefined;
    }

    draftModeUrl.searchParams.set('redirect', path);

    return {
      iframeUrl: draftModeUrl.toString(),
      // Preview endpoints can use another deployment hostname while sharing
      // the configured draft-mode route. The route itself is what determines
      // whether the iframe has already enabled draft content.
      alreadyInDraftMode:
        previewUrl.pathname === draftModeUrl.pathname && redirect !== null,
    };
  } catch {
    return undefined;
  }
}

// Same pattern the Inspector sends to @datocms/content-link on init: it tells
// the website how to recognise a DatoCMS edit URL and extract its parts.
const editUrlRegExp =
  /^(?<base_url>.+?)(?:\/environments\/(?<environment>[^/]+))?\/editor\/item_types\/(?<item_type_id>[^/]+)\/items\/(?<item_id>[^/]+)\/edit#fieldPath=(?<field_path>.+)$/;

function itemEditorUrl(ctx: RenderItemFormSidebarCtx, info: EditUrlInfo) {
  // Mirror inspectorUrl()'s environment-prefix convention (utils/urls.tsx), and
  // match the record-editor route that DatoCMS edit URLs use (ends in /edit).
  const prefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;

  const url = `${prefix}/editor/item_types/${info.itemTypeId}/items/${info.itemId}/edit`;

  // The #fieldPath hash makes the Studio scroll to and highlight the specific
  // field — essential when the clicked element belongs to the record already
  // open in the form.
  return info.fieldPath ? `${url}#fieldPath=${info.fieldPath}` : url;
}

/**
 * Wires a sidebar preview iframe to @datocms/content-link. Unlike the Inspector
 * (which opens records inside an inspector panel), a click here navigates the
 * whole Studio to the record's editor page.
 */
export function useSidebarContentLink(
  ctx: RenderItemFormSidebarCtx,
  editModeEnabled: boolean,
) {
  const currentEnvironmentId = ctx.isEnvironmentPrimary
    ? SYMBOL_FOR_PRIMARY_ENVIRONMENT
    : ctx.environment;

  const { iframeRef, connection } = useContentLinkConnection({
    onInit: () => ({
      editUrlRegExp: {
        source: editUrlRegExp.source,
        flags: editUrlRegExp.flags,
      },
    }),
    // The sidebar has no "records in this page" panel to sync.
    onStateChange: () => {},
    onPing: () => {},
    openItem: async (info) => {
      // Ignore clicks on records that belong to a different environment.
      if (info.environment !== currentEnvironmentId) {
        return;
      }

      await ctx.navigateTo(itemEditorUrl(ctx, info));
    },
  });

  // Keep the click-to-edit overlay in sync with the toggle. The connection
  // stays alive when the selected preview is already in draft mode; published
  // previews are reloaded through the draft-mode route before connecting.
  useEffect(() => {
    if (connection.type !== 'connected') {
      return;
    }

    connection.methods.setClickToEditEnabled(
      editModeEnabled
        ? { enabled: true, flash: { scrollToNearestTarget: false } }
        : { enabled: false },
    );
  }, [connection, editModeEnabled]);

  return { iframeRef };
}
