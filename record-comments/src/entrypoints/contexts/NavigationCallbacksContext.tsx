import { createContext, useContext, type ReactNode } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { useNavigationCallbacks } from '@hooks/useNavigationCallbacks';
import { usePageNavigationCallbacks } from '@hooks/usePageNavigationCallbacks';

import type { NavigableUserType } from '@utils/navigationHelpers';

// handleScrollToField: sidebar only. handleNavigateToRecordComments: page only.
export type NavigationCallbacks = {
  handleScrollToField?: (fieldPath: string, localized: boolean, locale?: string) => Promise<void>;
  handleNavigateToUsers: (userType?: NavigableUserType) => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
  handleNavigateToRecordComments?: (modelId: string, recordId: string) => Promise<void>;
};

export type { NavigableUserType };

const NavigationCallbacksContext = createContext<NavigationCallbacks | null>(null);

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

export function PageNavigationProvider({ ctx, children }: PageProviderProps) {
  const callbacks = usePageNavigationCallbacks(ctx);

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
