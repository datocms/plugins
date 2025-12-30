import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { FieldInfo, UserInfo, ModelInfo } from '@hooks/useMentions';
import type { TypedUserInfo } from '@utils/userDisplayResolver';

type ProjectDataContextType = {
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  currentUserEmail: string;
  typedUsers: TypedUserInfo[];
};

const ProjectDataContext = createContext<ProjectDataContextType | null>(null);

type ProjectDataProviderProps = {
  children: ReactNode;
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  currentUserEmail: string;
  typedUsers: TypedUserInfo[];
};

export function ProjectDataProvider({
  children,
  projectUsers,
  projectModels,
  modelFields,
  currentUserEmail,
  typedUsers,
}: ProjectDataProviderProps) {
  const value = useMemo(
    () => ({
      projectUsers,
      projectModels,
      modelFields,
      currentUserEmail,
      typedUsers,
    }),
    [projectUsers, projectModels, modelFields, currentUserEmail, typedUsers]
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
    throw new Error('useProjectDataContext must be used within a ProjectDataProvider');
  }
  return context;
}
