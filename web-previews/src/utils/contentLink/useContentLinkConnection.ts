import { type AsyncMethodReturns, connectToChild } from 'penpal';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  | { type: 'connected'; methods: AsyncMethodReturns<ContentLinkMethods> }
  | { type: 'failed' };

export type UseContentLinkConnectionReturn = {
  iframeRef: (element: HTMLIFrameElement | null) => void;
  connection: ContentLinkConnectionState;
};

type ActiveIframeConnection = {
  destroy: () => void;
  element: HTMLIFrameElement;
};

/**
 * Hook to manage Penpal connection with the preview iframe
 * Establishes bidirectional communication between Studio and Website
 */
export default function useContentLinkConnection({
  onInit,
  onPing,
  onStateChange,
  openItem,
}: WebPreviewsMethods): UseContentLinkConnectionReturn {
  const [connection, setConnection] = useState<ContentLinkConnectionState>({
    type: 'connecting',
  });

  const iframeStateRef = useRef<ActiveIframeConnection | null>(null);

  const handleOnInit = useMethodProxy(() => {
    return onInit();
  }, [onInit]);

  const handleOnPing = useMethodProxy(() => {
    onPing();
  }, [onPing]);

  const handleOpenItem = useMethodProxy(
    (info: EditUrlInfo) => {
      return openItem(info);
    },
    [openItem],
  );

  const handleStateChange = useMethodProxy(
    (payload: ContentLinkState) => {
      onStateChange(payload);
    },
    [onStateChange],
  );

  // Callback ref that establishes Penpal connection when iframe mounts
  const iframeRef = useCallback(
    (element: HTMLIFrameElement | null) => {
      if (
        iframeStateRef.current &&
        element === iframeStateRef.current.element
      ) {
        return;
      }

      const previousConnection = iframeStateRef.current;
      iframeStateRef.current = null;
      setConnection({ type: 'connecting' });
      previousConnection?.destroy();

      if (!element) {
        return;
      }

      try {
        const { promise, destroy } = connectToChild<ContentLinkMethods>({
          iframe: element,
          methods: {
            openItem: handleOpenItem,
            onStateChange: handleStateChange,
            onInit: handleOnInit,
            onPing: handleOnPing,
          },
          timeout: 20000,
        });

        const activeConnection: ActiveIframeConnection = {
          destroy,
          element,
        };
        iframeStateRef.current = activeConnection;

        void (async () => {
          try {
            const child = await promise;

            if (iframeStateRef.current !== activeConnection) {
              destroy();
              return;
            }

            setConnection({ type: 'connected', methods: child });
          } catch (error) {
            if (iframeStateRef.current !== activeConnection) {
              return;
            }

            console.error('Penpal connection failed:', error);
            setConnection({ type: 'failed' });
          }
        })();
      } catch (error) {
        console.error('Penpal connection failed:', error);
        setConnection({ type: 'failed' });
      }
    },
    [handleOnInit, handleOnPing, handleOpenItem, handleStateChange],
  );

  return useMemo<UseContentLinkConnectionReturn>(
    () => ({
      connection,
      iframeRef,
    }),
    [connection, iframeRef],
  );
}
