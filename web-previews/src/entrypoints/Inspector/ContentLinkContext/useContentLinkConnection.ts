import { connectToChild } from 'penpal';
import { useCallback, useRef, useState } from 'react';
import type {
  ContentLinkMethods,
  ContentLinkState,
  EditUrlInfo,
  WebPreviewsMethods,
} from './types';
import useMethodProxy from './useMethodProxy';

// Connection state for Penpal
export type ContentLinkConnectionState =
  | { type: 'connecting' }
  | { type: 'connected'; methods: ContentLinkMethods }
  | { type: 'error' };

export type UseContentLinkConnectionReturn = {
  iframeRef: (element: HTMLIFrameElement | null) => void;
  connection: ContentLinkConnectionState;
};

/**
 * Hook to manage Penpal connection with the preview iframe
 * Establishes bidirectional communication between Studio and Website
 */
export default function useContentLinkConnection({
  onStateChange,
  openItem,
}: WebPreviewsMethods): UseContentLinkConnectionReturn {
  const [connection, setConnection] = useState<ContentLinkConnectionState>({
    type: 'connecting',
  });

  const iframeStateRef = useRef<{
    destroy?: () => void;
    element: HTMLIFrameElement;
  } | null>(null);

  const handleOpenItem = useMethodProxy(
    (info: EditUrlInfo) => {
      openItem(info);
    },
    [openItem]
  );

  const handleStateChange = useMethodProxy(
    (payload: ContentLinkState) => {
      onStateChange(payload);
    },
    [onStateChange]
  );

  // Callback ref that establishes Penpal connection when iframe mounts
  const iframeRef = useCallback((element: HTMLIFrameElement | null) => {
    if (iframeStateRef.current && element === iframeStateRef.current.element) {
      return;
    }

    console.log('ELEMENT', element);

    // Cleanup previous connection if exists
    if (iframeStateRef.current) {
      console.log('ELEMENT CHANGED, DESTROYING THE OLD ONE');
      iframeStateRef.current.destroy?.();
      iframeStateRef.current = null;
    }

    if (!element) {
      setConnection({ type: 'connecting' });
      return;
    }

    iframeStateRef.current = { element };

    // Establish new connection
    (async () => {
      try {
        const { promise, destroy } = await connectToChild<ContentLinkMethods>({
          iframe: element,
          methods: {
            openItem: handleOpenItem,
            onStateChange: handleStateChange,
          },
          timeout: 20000,
        });

        if (
          iframeStateRef.current &&
          iframeStateRef.current.element === element
        ) {
          iframeStateRef.current.destroy = destroy;
        }

        const child = await promise;

        console.log('CONNECTION COMPLETED SUCCESSFULLY!');

        setConnection({ type: 'connected', methods: child });
      } catch (error) {
        console.error('Penpal connection failed:', error);
        setConnection({ type: 'error' });
      }
    })();
  }, []);

  return {
    connection,
    iframeRef,
  };
}
