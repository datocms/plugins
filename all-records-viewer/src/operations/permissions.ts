import type { ModelSummary, RawItem } from '../types';
import type {
  Identity,
  ItemPermissionRule,
  PermissionAction,
  PermissionContext,
} from './types';

type Match = 'yes' | 'no' | 'unknown';

export function identityKey(identity: Identity): string {
  return `${identity.type}:${identity.id}`;
}

function sameIdentity(left: Identity | null, right: Identity): boolean {
  return Boolean(left && left.id === right.id && left.type === right.type);
}

function creatorRoleMatch(
  creator: Identity | null,
  permissions: PermissionContext,
): Match {
  if (!creator) {
    return 'no';
  }

  if (sameIdentity(creator, permissions.currentUser)) {
    return 'yes';
  }

  const roles = permissions.creatorRoleByIdentity;
  const key = identityKey(creator);

  if (!roles?.has(key)) {
    return 'unknown';
  }

  return roles.get(key) === permissions.role.id ? 'yes' : 'no';
}

/**
 * Mirrors the dashboard's creator-scope handling. Negative `self` and `role`
 * rules describe the complement of the scope and therefore invert the match.
 * Unknown creator roles remain potentially eligible so the server can make the
 * authoritative decision instead of the plugin hiding a valid action.
 */
function matchesCreator(
  rule: ItemPermissionRule,
  creator: Identity | null,
  permissions: PermissionContext,
  positive: boolean,
): Match {
  if (!rule.on_creator || rule.on_creator === 'anyone') {
    return 'yes';
  }

  const scopeMatch =
    rule.on_creator === 'self'
      ? sameIdentity(creator, permissions.currentUser)
        ? 'yes'
        : 'no'
      : creatorRoleMatch(creator, permissions);

  if (scopeMatch === 'unknown') {
    return 'unknown';
  }

  if (positive) {
    return scopeMatch;
  }

  return scopeMatch === 'yes' ? 'no' : 'yes';
}

function matchesAction(
  rule: ItemPermissionRule,
  action: PermissionAction,
): boolean {
  return rule.action === 'all' || rule.action === action;
}

function matchesModel(rule: ItemPermissionRule, model: ModelSummary): boolean {
  if (rule.item_type) {
    return rule.item_type === model.id;
  }

  if (rule.workflow) {
    return rule.workflow === model.workflowId;
  }

  return true;
}

function matchesStage(rule: ItemPermissionRule, item: RawItem): boolean {
  return rule.on_stage ? rule.on_stage === item.meta.stage : true;
}

function matchesDestination(
  rule: ItemPermissionRule,
  action: PermissionAction,
  destinationStageId: string | undefined,
): boolean {
  if (action !== 'move_to_stage') {
    return true;
  }

  return rule.to_stage ? rule.to_stage === destinationStageId : true;
}

function itemCreator(item: RawItem): Identity | null {
  return item.relationships.creator?.data ?? null;
}

function itemRules(
  permissions: PermissionContext,
  positive: boolean,
): readonly ItemPermissionRule[] {
  const finalPermissions = permissions.role.meta.final_permissions;
  const rawRules = positive
    ? finalPermissions.positive_item_type_permissions
    : finalPermissions.negative_item_type_permissions;

  return rawRules as unknown as readonly ItemPermissionRule[];
}

type RuleCache = WeakMap<
  ModelSummary,
  Map<string, readonly ItemPermissionRule[]>
>;
const ruleCaches = new WeakMap<PermissionContext, RuleCache>();

function scopedRules(args: {
  model: ModelSummary;
  permissions: PermissionContext;
  action: PermissionAction;
  destinationStageId?: string;
  positive: boolean;
}): readonly ItemPermissionRule[] {
  let cache = ruleCaches.get(args.permissions);
  if (!cache) {
    cache = new WeakMap();
    ruleCaches.set(args.permissions, cache);
  }
  let modelRules = cache.get(args.model);
  if (!modelRules) {
    modelRules = new Map();
    cache.set(args.model, modelRules);
  }
  const key = `${args.action}:${args.destinationStageId ?? ''}:${args.positive}`;
  const cached = modelRules.get(key);
  if (cached) return cached;
  const rules = itemRules(args.permissions, args.positive).filter(
    (rule) =>
      rule.environment === args.permissions.environment &&
      matchesAction(rule, args.action) &&
      matchesModel(rule, args.model) &&
      matchesDestination(rule, args.action, args.destinationStageId),
  );
  modelRules.set(key, rules);
  return rules;
}

function hasMatchingRule(args: {
  item: RawItem;
  model: ModelSummary;
  permissions: PermissionContext;
  action: PermissionAction;
  destinationStageId?: string;
  positive: boolean;
}): boolean {
  const creator = itemCreator(args.item);
  for (const rule of scopedRules(args)) {
    if (!matchesStage(rule, args.item)) continue;
    const match = matchesCreator(
      rule,
      creator,
      args.permissions,
      args.positive,
    );
    if (args.positive ? match !== 'no' : match === 'yes') return true;
  }
  return false;
}

export function isPotentiallyEligible(args: {
  item: RawItem;
  model: ModelSummary;
  permissions: PermissionContext;
  action: PermissionAction;
  destinationStageId?: string;
}): boolean {
  return (
    hasMatchingRule({ ...args, positive: true }) &&
    !hasMatchingRule({ ...args, positive: false })
  );
}
