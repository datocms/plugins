import type { Mention } from '@ctypes/mentions';
import { createContext, type ReactNode, useContext } from 'react';

export type NavigationCallbacks = {
  handleScrollToField?: (
    fieldPath: string,
    localized: boolean,
    locale?: string,
  ) => void | Promise<void>;
  handleOpenUser?: (userId: string) => void | Promise<void>;
  handleOpenModel?: (
    modelId: string,
    isBlockModel: boolean,
  ) => void | Promise<void>;
  handleOpenAsset: (assetId: string) => void | Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => void | Promise<void>;
};

const NavigationCallbacksContext = createContext<NavigationCallbacks | null>(
  null,
);

export function useNavigationContext(): NavigationCallbacks {
  const context = useContext(NavigationCallbacksContext);
  if (!context) {
    throw new Error(
      'useNavigationContext must be used within a NavigationCallbacksProvider',
    );
  }
  return context;
}

export function NavigationCallbacksProvider({
  callbacks,
  children,
}: {
  callbacks: NavigationCallbacks;
  children: ReactNode;
}) {
  return (
    <NavigationCallbacksContext.Provider value={callbacks}>
      {children}
    </NavigationCallbacksContext.Provider>
  );
}

export async function openMention(
  callbacks: NavigationCallbacks,
  mention: Mention,
): Promise<void> {
  switch (mention.type) {
    case 'user':
      await callbacks.handleOpenUser?.(mention.id);
      break;
    case 'field':
      await callbacks.handleScrollToField?.(
        mention.fieldPath,
        mention.localized,
        mention.locale,
      );
      break;
    case 'asset':
      await callbacks.handleOpenAsset(mention.id);
      break;
    case 'record':
      await callbacks.handleOpenRecord(mention.id, mention.modelId);
      break;
    case 'model':
      await callbacks.handleOpenModel?.(mention.id, mention.isBlockModel);
      break;
  }
}
