import { createContext, useContext, type ReactNode } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { useNavigationCallbacks } from '@hooks/useNavigationCallbacks';
import { usePageNavigationCallbacks } from '@hooks/usePageNavigationCallbacks';

/**
 * Navigation callbacks available in both sidebar and page contexts.
 * handleScrollToField is only available in sidebar context.
 * handleNavigateToRecordComments is only available in page context.
 */
export type NavigationCallbacks = {
  handleScrollToField?: (fieldPath: string, localized: boolean, locale?: string) => Promise<void>;
  handleNavigateToUsers: () => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
  handleNavigateToRecordComments?: (modelId: string, recordId: string) => Promise<void>;
};

const NavigationCallbacksContext = createContext<NavigationCallbacks | null>(null);

/**
 * Hook to access navigation callbacks from context.
 * Throws if used outside of a NavigationCallbacksProvider.
 */
export function useNavigationContext(): NavigationCallbacks {
  const context = useContext(NavigationCallbacksContext);
  if (!context) {
    throw new Error('useNavigationContext must be used within a NavigationCallbacksProvider');
  }
  return context;
}

type SidebarProviderProps = {
  ctx: RenderItemFormSidebarCtx;
  children: ReactNode;
};

/**
 * Provider for sidebar context (record editing view).
 * Includes handleScrollToField for field navigation.
 */
export function SidebarNavigationProvider({ ctx, children }: SidebarProviderProps) {
  const callbacks = useNavigationCallbacks(ctx);

  return (
    <NavigationCallbacksContext.Provider value={callbacks}>
      {children}
    </NavigationCallbacksContext.Provider>
  );
}

type PageProviderProps = {
  ctx: RenderPageCtx;
  children: ReactNode;
};

/**
 * Provider for page context (dashboard/global comments view).
 * Includes handleNavigateToRecordComments for navigating to records.
 * Does NOT include handleScrollToField since there's no record context.
 */
export function PageNavigationProvider({ ctx, children }: PageProviderProps) {
  const callbacks = usePageNavigationCallbacks(ctx);

  // Wrap page callbacks to match the NavigationCallbacks type
  const value: NavigationCallbacks = {
    handleNavigateToUsers: callbacks.handleNavigateToUsers,
    handleNavigateToModel: callbacks.handleNavigateToModel,
    handleOpenAsset: callbacks.handleOpenAsset,
    handleOpenRecord: callbacks.handleOpenRecord,
    handleNavigateToRecordComments: callbacks.handleNavigateToRecordComments,
  };

  return (
    <NavigationCallbacksContext.Provider value={value}>
      {children}
    </NavigationCallbacksContext.Provider>
  );
}
