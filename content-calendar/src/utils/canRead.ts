import type { SchemaTypes } from '@datocms/cma-client';
import type { Role } from 'datocms-plugin-sdk';
import { isEqual, omit, uniq } from 'lodash-es';

const action = 'read' as const;

export type ItemTypeRule = Omit<
  SchemaTypes.RoleMeta['final_permissions']['positive_item_type_permissions'][0],
  'environment'
>;

export type Permissions = {
  positive_item_type_permissions: ItemTypeRule[];
  negative_item_type_permissions: ItemTypeRule[];
};

class Rules<T> {
  positive: T[];

  negative: T[];

  constructor(positive: T[], negative: T[]) {
    this.positive = positive;
    this.negative = negative;
  }

  filter(fn: (rule: T, positive: boolean) => boolean): Rules<T> {
    return new Rules(
      this.positive.filter((rule) => fn(rule, true)),
      this.negative.filter((rule) => fn(rule, false)),
    );
  }

  isPermissionGranted() {
    return this.positive.length > 0 && this.negative.length === 0;
  }

  map<U>(fn: (rule: T, positive: boolean) => U[]): Rules<U> {
    return new Rules(
      this.positive.flatMap((rule) => fn(rule, true)),
      this.negative.flatMap((rule) => fn(rule, false)),
    );
  }

  unique(): Rules<T> {
    return new Rules(uniq(this.positive), uniq(this.negative));
  }

  difference() {
    return this.positive.filter(
      (item) => !this.negative.some((x) => isEqual(x, item)),
    );
  }
}

function itemRules(permissions: Permissions) {
  return new Rules<ItemTypeRule>(
    permissions.positive_item_type_permissions,
    permissions.negative_item_type_permissions,
  );
}

const byAction = (action: string, rule: ItemTypeRule) =>
  rule.action === 'all' || rule.action === action;

type OnCreator = 'anyone' | 'self' | 'role';

/**
 * Reads a rule's `on_creator`.
 *
 * Each permission entry is a discriminated union on `action`, and only the
 * per-action members declare `on_creator` — the `action: 'all'` member exposes
 * it through its index signature, as `unknown`. `Omit` doesn't distribute over
 * unions, so `ItemTypeRule` collapses to the common keys and the property
 * arrives untyped whatever the action is. Hence the runtime check.
 */
const onCreator = (rule: ItemTypeRule): OnCreator | undefined => {
  const value = (rule as { on_creator?: unknown }).on_creator;

  return value === 'anyone' || value === 'self' || value === 'role'
    ? value
    : undefined;
};

const byItemType = (
  itemTypeId: SchemaTypes.ItemTypeIdentity,
  workflowId: SchemaTypes.WorkflowIdentity | undefined,
  rule: ItemTypeRule,
) =>
  rule.item_type
    ? rule.item_type === itemTypeId
    : rule.workflow
      ? rule.workflow === workflowId
      : true;

export function canReadAtLeastSomeItem(
  permissions: Permissions,
  itemType: SchemaTypes.ItemType,
): boolean {
  const rules = itemRules(permissions)
    .filter((rule) => byAction(action, rule))
    .filter((rule) =>
      byItemType(itemType.id, itemType.relationships.workflow.data?.id, rule),
    );

  return (
    rules
      .map((rule, positive) => {
        const sets: string[][] = [];
        const ruleOnCreator = onCreator(rule);

        if (!ruleOnCreator) {
          throw new Error('this should not happen');
        }

        sets.push(
          // se ho una regola negativa "anyone", mi cancella qualsiasi
          // regola positiva esistente
          !positive && ruleOnCreator === 'anyone'
            ? ['anyone', 'role', 'self']
            : [ruleOnCreator],
        );

        return cartesianProduct(sets);
      })
      .difference().length > 0
  );
}

function cartesianProduct<T>(arr: T[][]): T[][] {
  return arr.reduce(
    (a, b) => {
      return a
        .map((x) => {
          return b.map((y) => {
            return x.concat(y);
          });
        })
        .reduce((c, d) => c.concat(d), []);
    },
    [[]] as T[][],
  );
}

export function buildPermissions(
  role: Role,
  currentEnvironmentId: string,
): Permissions {
  return {
    positive_item_type_permissions:
      role.meta.final_permissions.positive_item_type_permissions
        .filter((rule) => rule.environment === currentEnvironmentId)
        .map((rule) => omit(rule, ['environment'])),
    negative_item_type_permissions:
      role.meta.final_permissions.negative_item_type_permissions
        .filter((rule) => rule.environment === currentEnvironmentId)
        .map((rule) => omit(rule, ['environment'])),
  };
}
