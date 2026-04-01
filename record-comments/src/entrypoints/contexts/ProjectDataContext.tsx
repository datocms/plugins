import type { FieldInfo, ModelInfo, UserInfo } from '@hooks/useMentions';
import type { TypedUserInfo } from '@utils/userDisplayResolver';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

type ProjectDataContextType = {
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  currentUserId: string;
  typedUsers: TypedUserInfo[];
};

const ProjectDataContext = createContext<ProjectDataContextType | null>(null);

type ProjectDataProviderProps = {
  children: ReactNode;
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  currentUserId: string;
  typedUsers: TypedUserInfo[];
};

export function ProjectDataProvider({
  children,
  projectUsers,
  projectModels,
  modelFields,
  currentUserId,
  typedUsers,
}: ProjectDataProviderProps) {
  const value = useMemo(
    () => ({
      projectUsers,
      projectModels,
      modelFields,
      currentUserId,
      typedUsers,
    }),
    [projectUsers, projectModels, modelFields, currentUserId, typedUsers],
  );

  return (
    <ProjectDataContext.Provider value={value}>
      {children}
    </ProjectDataContext.Provider>
  );
}

export function useProjectDataContext(): ProjectDataContextType {
  const context = useContext(ProjectDataContext);
  if (!context) {
    throw new Error(
      'useProjectDataContext must be used within a ProjectDataProvider',
    );
  }
  return context;
}
