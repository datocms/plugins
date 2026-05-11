import type { Role } from 'datocms-plugin-sdk';
import type { ModelSummary, PermissionView, PluginParameters } from '../types';

type RoleRule =
  Role['meta']['final_permissions']['positive_item_type_permissions'][number];

type Action = 'read' | 'update';

function matchesAction(rule: RoleRule, action: Action): boolean {
  return rule.action === 'all' || rule.action === action;
}

function matchesModel(rule: RoleRule, model: ModelSummary): boolean {
  if (rule.item_type != null) {
    return rule.item_type === model.id;
  }

  if (rule.workflow != null) {
    return rule.workflow === model.workflowId;
  }

  return true;
}

function matchingRules(
  rules: RoleRule[],
  environment: string,
  model: ModelSummary,
  action: Action,
): RoleRule[] {
  return rules.filter(
    (rule) =>
      rule.environment === environment &&
      matchesAction(rule, action) &&
      matchesModel(rule, model),
  );
}

function canPerformModelAction(
  role: Role,
  environment: string,
  model: ModelSummary,
  action: Action,
): boolean {
  const finalPermissions = role.meta.final_permissions;
  const positive = matchingRules(
    finalPermissions.positive_item_type_permissions,
    environment,
    model,
    action,
  );

  if (positive.length === 0) {
    return false;
  }

  const negative = matchingRules(
    finalPermissions.negative_item_type_permissions,
    environment,
    model,
    action,
  );

  return negative.length === 0;
}

export function canReadModel(
  role: Role,
  environment: string,
  model: ModelSummary,
): boolean {
  return canPerformModelAction(role, environment, model, 'read');
}

export function canUpdateModel(
  role: Role,
  environment: string,
  model: ModelSummary,
): boolean {
  return canPerformModelAction(role, environment, model, 'update');
}

export function buildPermissionView(args: {
  role: Role;
  environment: string;
  params: PluginParameters;
  tokenAvailable: boolean;
  models: ModelSummary[];
}): PermissionView {
  const { role, environment, params, tokenAvailable, models } = args;
  const roleAllowed =
    params.allowedRoleIds.length === 0 || params.allowedRoleIds.includes(role.id);

  const allowedModels = models.filter((model) => {
    if (
      params.allowedModelIds.length > 0 &&
      !params.allowedModelIds.includes(model.id)
    ) {
      return false;
    }

    return (
      canReadModel(role, environment, model) &&
      canUpdateModel(role, environment, model)
    );
  });

  return {
    canAccessPage: tokenAvailable && roleAllowed && allowedModels.length > 0,
    canEditSchema: role.meta.final_permissions.can_edit_schema,
    allowedModelIds: new Set(allowedModels.map((model) => model.id)),
  };
}
