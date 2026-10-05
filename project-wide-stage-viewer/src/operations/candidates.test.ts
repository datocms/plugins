import type { Role } from 'datocms-plugin-sdk';
import { describe, expect, it } from 'vitest';
import { MAX_BULK_ITEMS } from '../constants';
import type { ModelSummary, RawItem } from '../types';
import {
  availableMoveDestinationIds,
  evaluateMoveSelection,
  evaluateSelection,
  getMoveSelectionContext,
} from './candidates';
import { identityKey } from './permissions';
import type { ItemPermissionRule, PermissionContext } from './types';

const environment = 'main';

function model(
  id: string,
  options: {
    draftModeActive?: boolean;
    workflowId?: string | null;
  } = {},
): ModelSummary {
  return {
    id,
    name: id,
    apiKey: id,
    draftModeActive: options.draftModeActive ?? true,
    workflowId: options.workflowId ?? null,
  };
}

function item(
  id: string,
  modelId: string,
  options: {
    creatorId?: string;
    creatorType?: string;
    stage?: string | null;
    status?: RawItem['meta']['status'];
  } = {},
): RawItem {
  return {
    id,
    type: 'item',
    attributes: {},
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
      creator: {
        data: {
          id: options.creatorId ?? 'current-user',
          type: options.creatorType ?? 'user',
        },
      },
    },
    meta: {
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      published_at: null,
      first_published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      status: options.status ?? 'draft',
      is_valid: true,
      is_current_version_valid: true,
      is_published_version_valid: null,
      current_version: `version-${id}`,
      stage: options.stage ?? null,
      has_children: false,
    },
  } as unknown as RawItem;
}

function rule(
  action: ItemPermissionRule['action'],
  overrides: Partial<ItemPermissionRule> = {},
): ItemPermissionRule {
  return {
    action,
    environment,
    item_type: null,
    workflow: null,
    on_creator: 'anyone',
    ...overrides,
  };
}

function permissionContext(
  positive: readonly ItemPermissionRule[],
  negative: readonly ItemPermissionRule[] = [],
  creatorRoleByIdentity?: ReadonlyMap<string, string | null>,
): PermissionContext {
  const role = {
    id: 'role-1',
    meta: {
      final_permissions: {
        positive_item_type_permissions: positive,
        negative_item_type_permissions: negative,
      },
    },
  } as unknown as Role;

  return {
    role,
    environment,
    currentUser: { id: 'current-user', type: 'user' },
    creatorRoleByIdentity,
  };
}

function modelMap(...models: ModelSummary[]) {
  return new Map(models.map((entry) => [entry.id, entry]));
}

describe('evaluateSelection', () => {
  it('filters a mixed-model selection using model rules and draft mode', () => {
    const article = model('article');
    const product = model('product');
    const immediate = model('immediate', { draftModeActive: false });
    const result = evaluateSelection({
      action: 'publish',
      items: [
        item('article-1', article.id),
        item('product-1', product.id),
        item('immediate-1', immediate.id),
      ],
      modelsById: modelMap(article, product, immediate),
      permissions: permissionContext([
        rule('publish', { item_type: article.id }),
      ]),
    });

    expect(result.itemIds).toEqual(['article-1']);
    expect(result).toMatchObject({
      selectedCount: 3,
      eligibleCount: 1,
      excludedCount: 2,
      submittedCount: 1,
      overflowCount: 0,
      disabledReason: null,
    });
  });

  it('does not pre-filter publish or unpublish by record status', () => {
    const article = model('article');
    const items = [
      item('draft', article.id, { status: 'draft' }),
      item('published', article.id, { status: 'published' }),
      item('updated', article.id, { status: 'updated' }),
    ];
    const base = {
      items,
      modelsById: modelMap(article),
      permissions: permissionContext([rule('publish')]),
    };

    expect(evaluateSelection({ ...base, action: 'publish' }).itemIds).toEqual([
      'draft',
      'published',
      'updated',
    ]);
    expect(evaluateSelection({ ...base, action: 'unpublish' }).itemIds).toEqual(
      ['draft', 'published', 'updated'],
    );
  });

  it('applies creator and current-stage scopes to a subset', () => {
    const article = model('article', { workflowId: 'editorial' });
    const result = evaluateSelection({
      action: 'delete',
      items: [
        item('allowed', article.id, { stage: 'review' }),
        item('wrong-creator', article.id, {
          creatorId: 'someone-else',
          stage: 'review',
        }),
        item('wrong-stage', article.id, { stage: 'draft' }),
      ],
      modelsById: modelMap(article),
      permissions: permissionContext([
        rule('delete', {
          item_type: article.id,
          on_creator: 'self',
          on_stage: 'review',
        }),
      ]),
    });

    expect(result.itemIds).toEqual(['allowed']);
    expect(result.excludedCount).toBe(2);
  });

  it('handles action=all, workflow targeting, environment, and negative rules', () => {
    const article = model('article', { workflowId: 'editorial' });
    const page = model('page', { workflowId: 'editorial' });
    const result = evaluateSelection({
      action: 'delete',
      items: [item('article-1', article.id), item('page-1', page.id)],
      modelsById: modelMap(article, page),
      permissions: permissionContext(
        [rule('all', { workflow: 'editorial' })],
        [
          rule('delete', { item_type: page.id }),
          rule('delete', {
            item_type: article.id,
            environment: 'another-environment',
          }),
        ],
      ),
    });

    expect(result.itemIds).toEqual(['article-1']);
  });

  it('uses known creator roles and leaves unknown roles potentially eligible', () => {
    const article = model('article');
    const knownOther = { id: 'known-other', type: 'user' };
    const unknown = { id: 'unknown', type: 'access_token' };
    const creatorRoles = new Map<string, string | null>([
      [identityKey(knownOther), 'role-2'],
    ]);
    const result = evaluateSelection({
      action: 'delete',
      items: [
        item('known-other-item', article.id, {
          creatorId: knownOther.id,
          creatorType: knownOther.type,
        }),
        item('unknown-item', article.id, {
          creatorId: unknown.id,
          creatorType: unknown.type,
        }),
      ],
      modelsById: modelMap(article),
      permissions: permissionContext(
        [rule('delete', { on_creator: 'role' })],
        [],
        creatorRoles,
      ),
    });

    expect(result.itemIds).toEqual(['unknown-item']);
  });

  it('keeps every eligible ID when selection exceeds one API batch', () => {
    const article = model('article');
    const items = Array.from({ length: MAX_BULK_ITEMS + 5 }, (_, index) =>
      item(`item-${index}`, article.id),
    );
    const result = evaluateSelection({
      action: 'delete',
      items,
      modelsById: modelMap(article),
      permissions: permissionContext([rule('delete')]),
    });

    expect(result).toMatchObject({
      selectedCount: 205,
      eligibleCount: 205,
      submittedCount: 205,
      overflowCount: 0,
      itemIds: items.map((entry) => entry.id),
      disabledReason: null,
    });
  });

  it('returns a user-facing reason when no records are eligible', () => {
    const article = model('article');
    const result = evaluateSelection({
      action: 'delete',
      items: [item('article-1', article.id)],
      modelsById: modelMap(article),
      permissions: permissionContext([]),
    });

    expect(result.disabledReason).toBe(
      'Your role cannot delete any of the selected records.',
    );
  });
});

describe('workflow movement', () => {
  it('moves records of different models that share a workflow', () => {
    const article = model('article', { workflowId: 'editorial' });
    const page = model('page', { workflowId: 'editorial' });
    const items = [
      item('article-1', article.id, { stage: 'draft' }),
      item('page-1', page.id, { stage: 'draft' }),
    ];
    const input = {
      items,
      modelsById: modelMap(article, page),
      permissions: permissionContext([
        rule('move_to_stage', { item_type: 'article' }),
      ]),
    };

    expect(getMoveSelectionContext(input)).toEqual({
      enabled: true,
      workflowId: 'editorial',
      disabledReason: null,
    });
    // Each record is checked against its own model's rules.
    expect(
      evaluateMoveSelection({ ...input, destinationStageId: 'review' }),
    ).toMatchObject({ itemIds: ['article-1'], excludedCount: 1 });
  });

  it('refuses records from different workflows, or none', () => {
    const article = model('article', { workflowId: 'editorial' });
    const page = model('page', { workflowId: 'legal' });
    const plain = model('plain');

    expect(
      getMoveSelectionContext({
        items: [item('a', article.id), item('p', page.id)],
        modelsById: modelMap(article, page),
      }),
    ).toEqual({
      enabled: false,
      workflowId: null,
      disabledReason:
        'Records must use the same workflow to move them between stages.',
    });
    expect(
      getMoveSelectionContext({
        items: [item('x', plain.id)],
        modelsById: modelMap(plain),
      }).disabledReason,
    ).toBe('Some of the selected records do not use a workflow.');
  });

  it('keeps model/workflow availability separate from stage permission checks', () => {
    const article = model('article', { workflowId: 'editorial' });
    const items = [item('one', article.id, { stage: 'draft' })];
    const context = getMoveSelectionContext({
      items,
      modelsById: modelMap(article),
    });

    expect(context).toMatchObject({
      enabled: true,
      workflowId: 'editorial',
    });

    const input = {
      items,
      modelsById: modelMap(article),
      permissions: permissionContext([
        rule('move_to_stage', {
          workflow: 'editorial',
          on_stage: 'draft',
          to_stage: 'review',
        }),
      ]),
    };

    expect(
      availableMoveDestinationIds({
        ...input,
        destinationStageIds: ['draft', 'review', 'published'],
      }),
    ).toEqual(['review']);
    expect(
      evaluateMoveSelection({
        ...input,
        destinationStageId: 'review',
      }).itemIds,
    ).toEqual(['one']);
  });
});
