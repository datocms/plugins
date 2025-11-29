import cuid from 'cuid';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ContentLinkMethods,
  ContentLinkState,
  SYMBOL_FOR_PRIMARY_ENVIRONMENT,
} from './types';
import useContentLinkConnection from './useContentLinkConnection';
import { useCtx } from 'datocms-react-ui';
import { RenderInspectorCtx } from 'datocms-plugin-sdk';

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
  undefined
);

export const useContentLink = () => {
  const context = useContext(VisualEditingContext);
  if (!context) {
    throw new Error(
      'useVisualEditing must be used within VisualEditingProvider'
    );
  }
  return context;
};

type Props = {
  children: ReactNode;
};

export function ContentLinkContextProvider({ children }: Props) {
  const ctx = useCtx<RenderInspectorCtx>();

  const firstWebsiteStateChangeRef = useRef(true);
  const [contentLinkState, setContentLinkState] = useState<
    CleanContentLinkState | undefined
  >(undefined);

  const currentEnvironmentId = ctx.isEnvironmentPrimary
    ? SYMBOL_FOR_PRIMARY_ENVIRONMENT
    : ctx.environment;

  const [iframeState, setIframeState] = useState<IframeState>({
    path: '/blog',
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

        connection.methods.setClickToEditEnabled({ enabled: true });
      }
    },
    openItem: (info) => {
      if (info.environment !== currentEnvironmentId) {
        return;
      }

      ctx.setInspectorMode({ type: 'itemEditor', ...info });
    },
  });

  useEffect(() => {
    if (connection.type !== 'connected') {
      firstWebsiteStateChangeRef.current = true;
    }
  }, [connection.type]);

  useEffect(() => {
    ctx.setInspectorMode({ type: 'itemList' });
  }, [contentLinkState?.path]);

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
