import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Context for mention permissions.
 * Controls which mention types are available to the user.
 */
type MentionPermissionsContextType = {
  /** Whether user can mention #fields */
  canMentionFields: boolean;
  /** Whether user can mention ^assets */
  canMentionAssets: boolean;
  /** Whether user can mention $models */
  canMentionModels: boolean;
};

const MentionPermissionsContext = createContext<MentionPermissionsContextType | null>(null);

type MentionPermissionsProviderProps = {
  children: ReactNode;
  canMentionFields?: boolean;
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
};

/**
 * Provider for mention permissions.
 * Wrap your comments list with this to provide permission info to all nested Comment components.
 */
export function MentionPermissionsProvider({
  children,
  canMentionFields = true,
  canMentionAssets = false,
  canMentionModels = true,
}: MentionPermissionsProviderProps) {
  // Memoize the context value to prevent unnecessary re-renders
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

/**
 * Hook to access mention permissions.
 * Must be used within a MentionPermissionsProvider.
 */
export function useMentionPermissionsContext(): MentionPermissionsContextType {
  const context = useContext(MentionPermissionsContext);
  if (!context) {
    throw new Error('useMentionPermissionsContext must be used within a MentionPermissionsProvider');
  }
  return context;
}
