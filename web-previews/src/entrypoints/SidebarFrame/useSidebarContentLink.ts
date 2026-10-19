import type { AsyncMethodReturns } from 'penpal';
import { useEffect } from 'react';
import type { ContentLinkMethods } from '../../utils/contentLink/types';
import useContentLinkConnection from '../../utils/contentLink/useContentLinkConnection';

// Same pattern the Inspector sends to @datocms/content-link on init: it tells
// the website how to recognise a DatoCMS edit URL and extract its parts.
const editUrlRegExp =
  /^(?<base_url>.+?)(?:\/environments\/(?<environment>[^/]+))?\/editor\/item_types\/(?<item_type_id>[^/]+)\/items\/(?<item_id>[^/]+)\/edit#fieldPath=(?<field_path>.+)$/;

/** Turns click-to-edit off, ignoring a page that went away meanwhile. */
function disableClickToEdit(methods: AsyncMethodReturns<ContentLinkMethods>) {
  methods.setClickToEditEnabled({ enabled: false }).catch((error: unknown) => {
    const connectionWasDestroyed =
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_CONNECTION_DESTROYED';

    if (!connectionWasDestroyed) {
      console.error('[Web Previews] Could not disable edit mode:', error);
    }
  });
}

/**
 * Wires a draft sidebar preview to @datocms/content-link only to keep its
 * click-to-edit off: click-to-edit belongs to the Visual Editing tab. The page
 * can still turn it on (holding Alt), so every state change re-disables it,
 * and clicks that slip through open nothing.
 */
export function useSidebarContentLink() {
  const { iframeRef, connection } = useContentLinkConnection({
    onInit: () => ({
      editUrlRegExp: {
        source: editUrlRegExp.source,
        flags: editUrlRegExp.flags,
      },
    }),
    onStateChange: ({ clickToEditEnabled }) => {
      if (clickToEditEnabled && connection.type === 'connected') {
        disableClickToEdit(connection.methods);
      }
    },
    onPing: () => {},
    openItem: () => {},
  });

  useEffect(() => {
    if (connection.type === 'connected') {
      disableClickToEdit(connection.methods);
    }
  }, [connection]);

  return { iframeRef };
}
