import cuid from 'cuid';
import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type { AsyncMethodReturns } from 'penpal';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Frontend } from '../../../types';
import {
  type ContentLinkMethods,
  type ContentLinkState,
  SYMBOL_FOR_PRIMARY_ENVIRONMENT,
} from '../../../utils/contentLink/types';
import useContentLinkConnection from '../../../utils/contentLink/useContentLinkConnection';
import { normalizePathForVisualEditing } from '../../../utils/normalizePathForVisualEditing';
import { inspectorUrl } from '../../../utils/urls';

type IframeState = { path: string; key: string };

type CleanContentLinkState = Omit<ContentLinkState, 'itemIdsPerEnvironment'>;

type InspectorPanelSyncState =
  | { type: 'itemList'; path: string }
  | { type: 'wrongEnvironment'; path: string; environments: string[] };

function getInspectorPanelSyncKey(
  frontendName: string,
  panelState: InspectorPanelSyncState,
) {
  return [frontendName, panelState.path, panelState.type].join('\u0000');
}

interface ContextValue {
  contentLink:
    | { type: 'connecting' }
    | {
        type: 'connected';
        state: CleanContentLinkState;
        methods: AsyncMethodReturns<ContentLinkMethods>;
      }
    | { type: 'error'; reason: 'no-ping' | 'failed-connection' };

  iframeRef: (element: HTMLIFrameElement | null) => void;
  iframeState: IframeState;
  setIframeState: (state: IframeState) => void;
  reloadIframe: () => void;
}

export const VisualEditingContext = createContext<ContextValue | undefined>(
  undefined,
);

export const useContentLink = () => {
  const context = useContext(VisualEditingContext);
  if (!context) {
    throw new Error(
      'useVisualEditing must be used within VisualEditingProvider',
    );
  }
  return context;
};

type Props = {
  children: ReactNode;
  frontend: Frontend;
};

const editUrlRegExp =
  /^(?<base_url>.+?)(?:\/environments\/(?<environment>[^/]+))?\/editor\/item_types\/(?<item_type_id>[^/]+)\/items\/(?<item_id>[^/]+)\/edit#fieldPath=(?<field_path>.+)$/;

const PING_TIMEOUT_MS = 25_000;

export function ContentLinkContextProvider({ children, frontend }: Props) {
  const ctx = useCtx<RenderInspectorCtx>();

  if (!frontend.visualEditing) {
    throw new Error(
      `Frontend "${frontend.name}" is missing visualEditing configuration.`,
    );
  }
  const currentVisualEditing = frontend.visualEditing;
  const fallbackPath = currentVisualEditing.initialPath || '/';

  const [contentLinkState, setContentLinkState] = useState<
    CleanContentLinkState | undefined
  >(undefined);
  const [inspectorPanelSyncState, setInspectorPanelSyncState] = useState<
    InspectorPanelSyncState | undefined
  >(undefined);
  const lastSyncedInspectorPanelKeyRef = useRef<string | undefined>(undefined);
  const lastFlashStateRef = useRef<{
    clickToEditEnabled: boolean;
    connectionReady: boolean;
    panelKey: string | undefined;
  }>({
    clickToEditEnabled: false,
    connectionReady: false,
    panelKey: undefined,
  });

  const [isPingActive, setIsPingActive] = useState<boolean>(true);
  const lastPingTimeRef = useRef<number>(Date.now());

  const currentEnvironmentId = ctx.isEnvironmentPrimary
    ? SYMBOL_FOR_PRIMARY_ENVIRONMENT
    : ctx.environment;

  const [iframeState, setIframeState] = useState<IframeState>(() => ({
    path: normalizePathForVisualEditing({
      path: new URLSearchParams(ctx.location.search).get('path'),
      draftModeUrl: currentVisualEditing.enableDraftModeUrl,
      fallbackPath,
    }),
    key: cuid(),
  }));
  const lastVisitedPathRef = useRef(iframeState.path);

  const { iframeRef, connection } = useContentLinkConnection({
    onInit: () => {
      if (connection.type === 'connected') {
        connection.methods.setClickToEditEnabled({
          enabled: true,
          flash: { scrollToNearestTarget: false },
        });
      }

      return {
        editUrlRegExp: {
          source: editUrlRegExp.source,
          flags: editUrlRegExp.flags,
        },
      };
    },
    onStateChange: ({ itemIdsPerEnvironment, ...rest }) => {
      setContentLinkState(rest);

      const currentEnvItems = itemIdsPerEnvironment[currentEnvironmentId] ?? [];
      const safePath = normalizePathForVisualEditing({
        path: rest.path,
        draftModeUrl: currentVisualEditing.enableDraftModeUrl,
        fallbackPath,
      });

      // Check for items from other environments
      const otherEnvironments = Object.keys(itemIdsPerEnvironment).filter(
        (env) =>
          env !== currentEnvironmentId && itemIdsPerEnvironment[env].length > 0,
      );

      if (otherEnvironments.length > 0) {
        console.warn(
          `Content link returned items from environments that don't match the current environment (${currentEnvironmentId}):`,
          otherEnvironments,
        );
      }

      // If there are NO records for the current environment but there are records from other environments
      if (currentEnvItems.length === 0 && otherEnvironments.length > 0) {
        setInspectorPanelSyncState({
          type: 'wrongEnvironment',
          path: safePath,
          environments: otherEnvironments,
        });
      } else {
        ctx.setInspectorItemListData({
          title: 'Records in this page',
          itemIds: currentEnvItems,
        });
        setInspectorPanelSyncState({ type: 'itemList', path: safePath });
      }

      lastVisitedPathRef.current = safePath;
    },
    openItem: async (info) => {
      if (info.environment !== currentEnvironmentId) {
        return;
      }

      await ctx.setInspectorMode({ type: 'itemEditor', ...info });
    },
    onPing: () => {
      lastPingTimeRef.current = Date.now();
      setIsPingActive(true);
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      // Don't check for ping timeout when the tab is hidden
      if (document.hidden) {
        return;
      }

      const timeSinceLastPing = Date.now() - lastPingTimeRef.current;
      if (timeSinceLastPing >= PING_TIMEOUT_MS) {
        setIsPingActive(false);
      }
    }, 1000);

    // Reset ping state when tab becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        lastPingTimeRef.current = Date.now();
        setIsPingActive(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const [highlightedItemId, setHighligtedItemId] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (highlightedItemId && connection.type === 'connected') {
      connection.methods.flashItem({
        itemId: highlightedItemId,
        scrollToNearestTarget: true,
      });
    }
  }, [highlightedItemId, connection]);

  useEffect(() => {
    const itemId = ctx.highlightedItemId;
    setHighligtedItemId(itemId);
    setTimeout(() => {
      setHighligtedItemId((old) => (old === itemId ? undefined : old));
    }, 5000);
  }, [ctx.highlightedItemId]);

  useEffect(() => {
    if (!inspectorPanelSyncState) {
      return;
    }

    const panelKey = getInspectorPanelSyncKey(
      frontend.name,
      inspectorPanelSyncState,
    );

    if (lastSyncedInspectorPanelKeyRef.current === panelKey) {
      return;
    }

    lastSyncedInspectorPanelKeyRef.current = panelKey;

    if (inspectorPanelSyncState.type === 'wrongEnvironment') {
      ctx.setInspectorMode({
        type: 'customPanel',
        panelId: 'CONTENT_COMING_FROM_WRONG_ENVIRONMENT',
        parameters: { environments: inspectorPanelSyncState.environments },
      });
    } else {
      ctx.setInspectorMode(
        { type: 'itemList' },
        { ignoreIfUnsavedChanges: true },
      );
    }

    ctx.navigateTo(
      inspectorUrl(ctx, {
        path: inspectorPanelSyncState.path,
        frontend: frontend.name,
      }),
    );
  }, [frontend.name, inspectorPanelSyncState, ctx]);

  useEffect(() => {
    const clickToEditEnabled = contentLinkState?.clickToEditEnabled ?? false;
    const connectionReady = connection.type === 'connected';
    const panelKey = inspectorPanelSyncState
      ? getInspectorPanelSyncKey(frontend.name, inspectorPanelSyncState)
      : undefined;
    const lastFlashState = lastFlashStateRef.current;

    lastFlashStateRef.current = {
      clickToEditEnabled,
      connectionReady,
      panelKey,
    };

    if (!connectionReady || !clickToEditEnabled || !panelKey) {
      return;
    }

    const shouldFlash =
      lastFlashState.panelKey !== panelKey ||
      !lastFlashState.clickToEditEnabled ||
      !lastFlashState.connectionReady;

    if (shouldFlash) {
      connection.methods.flashAll({ scrollToNearestTarget: false });
    }
  }, [
    contentLinkState?.clickToEditEnabled,
    connection,
    frontend.name,
    inspectorPanelSyncState,
  ]);

  const reloadIframe = useCallback(() => {
    lastPingTimeRef.current = Date.now();
    setIsPingActive(true);
    setIframeState({ path: lastVisitedPathRef.current, key: cuid() });
  }, []);

  const value: ContextValue = {
    iframeRef,

    iframeState,
    setIframeState,
    reloadIframe,

    contentLink:
      connection.type === 'failed'
        ? { type: 'error', reason: 'failed-connection' }
        : connection.type === 'connecting' || !contentLinkState
          ? { type: 'connecting' }
          : !isPingActive
            ? { type: 'error', reason: 'no-ping' }
            : {
                type: 'connected',
                state: contentLinkState,
                methods: connection.methods,
              },
  };

  return (
    <VisualEditingContext.Provider value={value}>
      {children}
    </VisualEditingContext.Provider>
  );
}
