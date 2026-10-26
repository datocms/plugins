import { createId } from '@paralleldrive/cuid2';
import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui/Canvas';
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
        /** Click-to-edit differs from the editor's choice: Alt is held in the preview */
        clickToEditTemporary: boolean;
      }
    | { type: 'error'; reason: 'no-ping' | 'failed-connection' };

  /** The frontend whose website the preview shows */
  frontend: Frontend;
  /** Opens the website of another frontend, at its initial path */
  changeFrontend: (frontend: Frontend) => void;

  iframeRef: (element: HTMLIFrameElement | null) => void;
  iframeState: IframeState;
  setIframeState: (state: IframeState) => void;
  reloadIframe: () => void;
  /** Record the editor's choice, so Alt flips can be told apart from it */
  setPreferredClickToEdit: (enabled: boolean) => void;
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
  /** The frontends with visual editing, in the order of the settings */
  frontends: Frontend[];
  /** The frontend that the URL of the Visual tab names when the tab opens */
  initialFrontend: Frontend;
};

const editUrlRegExp =
  /^(?<base_url>.+?)(?:\/environments\/(?<environment>[^/]+))?\/editor\/item_types\/(?<item_type_id>[^/]+)\/items\/(?<item_id>[^/]+)\/edit#fieldPath=(?<field_path>.+)$/;

const PING_TIMEOUT_MS = 25_000;

export function ContentLinkContextProvider({
  children,
  frontends,
  initialFrontend,
}: Props) {
  const ctx = useCtx<RenderInspectorCtx>();

  // The frontend of the preview lives here, and the URL only records it. The
  // website, the frontend menu and every URL that the panel sync writes thus
  // name the same frontend, also while the host is still applying a
  // navigation: a frontend read back from the URL would flip under the
  // website when a navigation lands late, and each flip would write the
  // other name, without end.
  const [frontendName, setFrontendName] = useState(initialFrontend.name);
  // A frontend removed from the settings while the tab is open gives way to
  // the first one
  const frontend =
    frontends.find((f) => f.name === frontendName) ??
    frontends[0] ??
    initialFrontend;

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
  // The last URL that the Visual tab asked the host for, which the panel sync
  // doesn't push again: after a frontend change, the first page that the new
  // website reports is that URL already
  const lastNavigatedUrlRef = useRef<string | undefined>(undefined);
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
    key: createId(),
  }));
  const lastVisitedPathRef = useRef(iframeState.path);

  // The click-to-edit state the editor chose. Content Link reports Alt flips
  // as plain state changes, so a mismatch with this means Alt is held.
  // Undefined until the page reports its initial state.
  const [preferredClickToEdit, setPreferredClickToEdit] = useState<
    boolean | undefined
  >(undefined);

  const { iframeRef, connection } = useContentLinkConnection({
    onInit: () => {
      setPreferredClickToEdit(
        connection.type === 'connected' ? true : undefined,
      );

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
      setPreferredClickToEdit(
        (preferred) => preferred ?? rest.clickToEditEnabled,
      );

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

    const url = inspectorUrl(ctx, {
      path: inspectorPanelSyncState.path,
      frontend: frontend.name,
    });

    if (lastNavigatedUrlRef.current !== url) {
      lastNavigatedUrlRef.current = url;
      ctx.navigateTo(url);
    }
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
    setIframeState({ path: lastVisitedPathRef.current, key: createId() });
  }, []);

  // Another frontend starts over: its website opens at its initial path, and
  // the panel sync waits for that website to report its first page. Thus no
  // URL pairs the page of the old website with the name of the new frontend.
  const changeFrontend = (nextFrontend: Frontend) => {
    const nextVisualEditing = nextFrontend.visualEditing ?? {
      enableDraftModeUrl: '',
      initialPath: '/',
    };
    const path = normalizePathForVisualEditing({
      path: nextVisualEditing.initialPath,
      draftModeUrl: nextVisualEditing.enableDraftModeUrl,
      fallbackPath: '/',
    });
    const url = inspectorUrl(ctx, { path, frontend: nextFrontend.name });

    setFrontendName(nextFrontend.name);
    setContentLinkState(undefined);
    setInspectorPanelSyncState(undefined);
    lastPingTimeRef.current = Date.now();
    setIsPingActive(true);
    lastVisitedPathRef.current = path;
    setIframeState({ path, key: createId() });
    lastNavigatedUrlRef.current = url;
    ctx.navigateTo(url);
  };

  const value: ContextValue = {
    frontend,
    changeFrontend,

    iframeRef,

    iframeState,
    setIframeState,
    reloadIframe,
    setPreferredClickToEdit,

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
                clickToEditTemporary:
                  preferredClickToEdit !== undefined &&
                  contentLinkState.clickToEditEnabled !== preferredClickToEdit,
              },
  };

  return (
    <VisualEditingContext.Provider value={value}>
      {children}
    </VisualEditingContext.Provider>
  );
}
