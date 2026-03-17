import { createContext, useContext, type ReactNode } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useNavigationCallbacks } from '@hooks/useNavigationCallbacks';

import type { NavigableUserType } from '@utils/navigationHelpers';

export type NavigationCallbacks = {
  handleScrollToField?: (fieldPath: string, localized: boolean, locale?: string) => Promise<void>;
  handleNavigateToUsers: (userType?: NavigableUserType) => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
};

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
