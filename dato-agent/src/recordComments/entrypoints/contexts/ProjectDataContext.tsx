import type { FieldInfo, ModelInfo, UserInfo } from '@hooks/useMentions';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

type ProjectDataContextType = {
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  currentUserId: string;
  currentRecordId?: string;
};

const ProjectDataContext = createContext<ProjectDataContextType | null>(null);

export function ProjectDataProvider({
  children,
  projectUsers,
  projectModels,
  modelFields,
  currentUserId,
  currentRecordId,
}: ProjectDataContextType & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      projectUsers,
      projectModels,
      modelFields,
      currentUserId,
      currentRecordId,
    }),
    [projectUsers, projectModels, modelFields, currentUserId, currentRecordId],
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
