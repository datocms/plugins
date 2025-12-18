export type StageMenuItem = {
  id: string;
  workflowId: string;
  workflowName: string;
  stageId: string;
  stageName: string;
  label?: string;
  icon?: string;
};

export type PluginParameters = {
  menuItems: StageMenuItem[];
};
