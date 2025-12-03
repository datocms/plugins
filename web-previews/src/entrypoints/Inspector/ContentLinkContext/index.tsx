import cuid from 'cuid';
import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type Parameters, normalizeParameters } from '../../../types';
import {
  type ContentLinkMethods,
  type ContentLinkState,
  SYMBOL_FOR_PRIMARY_ENVIRONMENT,
} from './types';
import useContentLinkConnection from './useContentLinkConnection';

type IframeState = { path: string; key: string };

type CleanContentLinkState = Omit<ContentLinkState, 'itemIdsPerEnvironment'>;

interface ContextValue {
  contentLink:
    | { type: 'connecting' }
    | {
        type: 'connected';
        state: CleanContentLinkState;
        methods: ContentLinkMethods;
      }
    | { type: 'error' };

  iframeRef: (element: HTMLIFrameElement | null) => void;
  iframeState: IframeState;
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
};

export function ContentLinkContextProvider({ children }: Props) {
  const ctx = useCtx<RenderInspectorCtx>();

  const { visualEditing } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const firstWebsiteStateChangeRef = useRef(true);
  const [contentLinkState, setContentLinkState] = useState<
    CleanContentLinkState | undefined
  >(undefined);

  const currentEnvironmentId = ctx.isEnvironmentPrimary
    ? SYMBOL_FOR_PRIMARY_ENVIRONMENT
    : ctx.environment;

  const [iframeState, setIframeState] = useState<IframeState>({
    path:
      new URLSearchParams(ctx.location.search).get('path') ||
      visualEditing?.initialPath ||
      '/',
    key: cuid(),
  });
  const lastVisitedPathRef = useRef(iframeState.path);

  const { iframeRef, connection } = useContentLinkConnection({
    onStateChange: ({ itemIdsPerEnvironment, ...rest }) => {
      setContentLinkState(rest);

      ctx.setInspectorItemListData({
        title: 'Records in this page',
        itemIds: itemIdsPerEnvironment[currentEnvironmentId] ?? [],
      });

      lastVisitedPathRef.current = rest.path;

      if (firstWebsiteStateChangeRef.current) {
        firstWebsiteStateChangeRef.current = false;

        if (connection.type !== 'connected') {
          return;
        }

        connection.methods.setClickToEditEnabled({
          enabled: true,
          flash: { scrollToNearestTarget: false },
        });
      }
    },
    openItem: (info) => {
      if (info.environment !== currentEnvironmentId) {
        return;
      }

      ctx.setInspectorMode({ type: 'itemEditor', ...info });
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (ctx.highlightedItemId && connection.type === 'connected') {
      connection.methods.flashItem({
        itemId: ctx.highlightedItemId,
        scrollToNearestTarget: true,
      });
    }
  }, [ctx.highlightedItemId]);

  useEffect(() => {
    if (connection.type !== 'connected') {
      firstWebsiteStateChangeRef.current = true;
    }
  }, [connection.type]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (!contentLinkState?.path) {
      return;
    }
    ctx.setInspectorMode(
      { type: 'itemList' },
      { ignoreIfUnsavedChanges: true },
    );

    ctx.navigateTo(
      `/p/${ctx.plugin.id}/inspectors/visual?${new URLSearchParams({
        path: contentLinkState.path,
      }).toString()}`,
    );

    if (
      connection.type === 'connected' &&
      contentLinkState.clickToEditEnabled
    ) {
      connection.methods.flashAll({ scrollToNearestTarget: false });
    }
  }, [
    contentLinkState?.path,
    contentLinkState?.clickToEditEnabled,
    connection,
  ]);

  const reloadIframe = useCallback(() => {
    setIframeState({ path: lastVisitedPathRef.current, key: cuid() });
  }, []);

  const value: ContextValue = {
    iframeRef,

    iframeState,
    reloadIframe,

    contentLink:
      connection.type === 'error'
        ? { type: 'error' }
        : connection.type === 'connecting' || !contentLinkState
          ? { type: 'connecting' }
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
