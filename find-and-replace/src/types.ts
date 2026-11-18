export type PluginParameters = {
  restrictToRoles: boolean;
  allowedRoleIds: string[];
  restrictToModels: boolean;
  allowedModelIds: string[];
  /** Searches leave out records in draft status (never published, or unpublished). */
  excludeUnpublished: boolean;
};

export type ModelSummary = {
  id: string;
  name: string;
  apiKey: string;
  workflowId: string | null;
};

export type RoleSummary = {
  id: string;
  name: string;
};

export type PermissionView = {
  canAccessPage: boolean;
  canEditSchema: boolean;
  allowedModelIds: Set<string>;
};
