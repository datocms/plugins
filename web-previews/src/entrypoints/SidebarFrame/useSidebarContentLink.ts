import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import type { Frontend, PreviewLinkWithFrontend } from '../../types';
import {
  type EditUrlInfo,
  SYMBOL_FOR_PRIMARY_ENVIRONMENT,
} from '../../utils/contentLink/types';
import useContentLinkConnection from '../../utils/contentLink/useContentLinkConnection';
import { extractRedirectFromDraftModePreviewUrl } from '../../utils/urls';

/**
 * A preview link supports visual editing when its frontend has draft mode
 * configured and the link URL is the draft-mode route (a page where
 * @datocms/content-link is active). Same gate the "Open in Visual" button uses.
 */
export function linkSupportsVisualEditing(
  link: PreviewLinkWithFrontend | undefined,
  frontend: Frontend | undefined,
): boolean {
  const enableDraftModeUrl = frontend?.visualEditing?.enableDraftModeUrl;
  if (!link || !enableDraftModeUrl) {
    return false;
  }
  return Boolean(
    extractRedirectFromDraftModePreviewUrl(link.url, enableDraftModeUrl),
  );
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
  // itself stays alive regardless of the toggle, so flipping it never reloads
  // the iframe — the user keeps whatever page they browsed to.
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
