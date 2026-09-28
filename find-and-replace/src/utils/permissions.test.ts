import type { Role } from 'datocms-plugin-sdk';
import { describe, expect, it } from 'vitest';
import type { ModelSummary, PluginParameters } from '../types';
import { buildPermissionView, isRoleAllowed } from './permissions';

const models: ModelSummary[] = [
  {
    id: 'article',
    name: 'Article',
    apiKey: 'article',
    workflowId: null,
  },
  {
    id: 'product',
    name: 'Product',
    apiKey: 'product',
    workflowId: null,
  },
];

const role = {
  id: 'editor',
  meta: {
    final_permissions: {
      can_edit_schema: false,
      positive_item_type_permissions: [
        {
          environment: 'main',
          action: 'all',
          item_type: null,
          workflow: null,
        },
      ],
      negative_item_type_permissions: [],
    },
  },
} as unknown as Role;

function parameters(
  overrides: Partial<PluginParameters> = {},
): PluginParameters {
  return {
    restrictToRoles: false,
    allowedRoleIds: [],
    restrictToModels: false,
    allowedModelIds: [],
    ...overrides,
  };
}

describe('plugin restrictions', () => {
  it('ignores retained allowlists while their switches are off', () => {
    const params = parameters({
      allowedRoleIds: ['different-role'],
      allowedModelIds: ['article'],
    });
    const view = buildPermissionView({
      role,
      environment: 'main',
      params,
      tokenAvailable: true,
      models,
    });

    expect(isRoleAllowed(params, role.id)).toBe(true);
    expect(view.canAccessPage).toBe(true);
    expect([...view.allowedModelIds]).toEqual(['article', 'product']);
  });

  it('applies role and model allowlists only when enabled', () => {
    const params = parameters({
      restrictToRoles: true,
      allowedRoleIds: ['editor'],
      restrictToModels: true,
      allowedModelIds: ['product'],
    });
    const view = buildPermissionView({
      role,
      environment: 'main',
      params,
      tokenAvailable: true,
      models,
    });

    expect(isRoleAllowed(params, role.id)).toBe(true);
    expect(view.canAccessPage).toBe(true);
    expect([...view.allowedModelIds]).toEqual(['product']);
  });

  it('denies page access when an enabled role restriction excludes the role', () => {
    const params = parameters({
      restrictToRoles: true,
      allowedRoleIds: ['admin'],
    });
    const view = buildPermissionView({
      role,
      environment: 'main',
      params,
      tokenAvailable: true,
      models,
    });

    expect(isRoleAllowed(params, role.id)).toBe(false);
    expect(view.canAccessPage).toBe(false);
  });
});
