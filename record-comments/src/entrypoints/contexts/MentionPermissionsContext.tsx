import { createContext, useContext, useMemo, type ReactNode } from 'react';

type MentionPermissionsContextType = {
  canMentionFields: boolean;
  canMentionAssets: boolean;
  canMentionModels: boolean;
};

const MentionPermissionsContext = createContext<MentionPermissionsContextType | null>(null);

type MentionPermissionsProviderProps = {
  children: ReactNode;
  canMentionFields?: boolean;
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
};

export function MentionPermissionsProvider({
  children,
  canMentionFields = true,
  canMentionAssets = false,
  canMentionModels = true,
}: MentionPermissionsProviderProps) {
  const value = useMemo(
    () => ({
      canMentionFields,
      canMentionAssets,
      canMentionModels,
    }),
    [canMentionFields, canMentionAssets, canMentionModels]
  );

  return (
    <MentionPermissionsContext.Provider value={value}>
      {children}
    </MentionPermissionsContext.Provider>
  );
}

export function useMentionPermissionsContext(): MentionPermissionsContextType {
  const context = useContext(MentionPermissionsContext);
  if (!context) {
    throw new Error('useMentionPermissionsContext must be used within a MentionPermissionsProvider');
  }
  return context;
}
