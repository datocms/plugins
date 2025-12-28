import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { FieldInfo, UserInfo, ModelInfo } from '@hooks/useMentions';
import type { UserOverrides } from '@utils/pluginParams';
import type { TypedUserInfo } from '@utils/userDisplayResolver';

/**
 * Context for project-level data used in comments.
 * Provides users, models, fields, and current user info.
 */
type ProjectDataContextType = {
  /** List of project users for @mentions */
  projectUsers: UserInfo[];
  /** List of project models for $mentions */
  projectModels: ModelInfo[];
  /** List of model fields for #mentions */
  modelFields: FieldInfo[];
  /** Current user's email for identifying own comments */
  currentUserEmail: string;
  /** User overrides from plugin parameters */
  userOverrides: UserOverrides | undefined;
  /** Users with type information for override resolution */
  typedUsers: TypedUserInfo[];
};

const ProjectDataContext = createContext<ProjectDataContextType | null>(null);

type ProjectDataProviderProps = {
  children: ReactNode;
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  currentUserEmail: string;
  userOverrides: UserOverrides | undefined;
  typedUsers: TypedUserInfo[];
};

/**
 * Provider for project-level data.
 * Wrap your comments list with this to provide project data to all nested Comment components.
 */
export function ProjectDataProvider({
  children,
  projectUsers,
  projectModels,
  modelFields,
  currentUserEmail,
  userOverrides,
  typedUsers,
}: ProjectDataProviderProps) {
  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      projectUsers,
      projectModels,
      modelFields,
      currentUserEmail,
      userOverrides,
      typedUsers,
    }),
    [projectUsers, projectModels, modelFields, currentUserEmail, userOverrides, typedUsers]
  );

  return (
    <ProjectDataContext.Provider value={value}>
      {children}
    </ProjectDataContext.Provider>
  );
}

/**
 * Hook to access project-level data.
 * Must be used within a ProjectDataProvider.
 */
export function useProjectDataContext(): ProjectDataContextType {
  const context = useContext(ProjectDataContext);
  if (!context) {
    throw new Error('useProjectDataContext must be used within a ProjectDataProvider');
  }
  return context;
}
