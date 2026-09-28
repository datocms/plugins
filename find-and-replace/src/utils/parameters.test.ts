import { describe, expect, it } from 'vitest';
import { readPluginParameters } from './parameters';

describe('readPluginParameters', () => {
  it('defaults both restrictions to off', () => {
    expect(readPluginParameters(undefined)).toEqual({
      restrictToRoles: false,
      allowedRoleIds: [],
      restrictToModels: false,
      allowedModelIds: [],
    });
  });

  it('migrates legacy non-empty allowlists to active restrictions', () => {
    expect(
      readPluginParameters({
        allowedRoleIds: ['editor'],
        allowedModelIds: ['article'],
      }),
    ).toEqual({
      restrictToRoles: true,
      allowedRoleIds: ['editor'],
      restrictToModels: true,
      allowedModelIds: ['article'],
    });
  });

  it('lets explicit booleans disable retained allowlists', () => {
    expect(
      readPluginParameters({
        restrictToRoles: false,
        allowedRoleIds: ['editor'],
        restrictToModels: false,
        allowedModelIds: ['article'],
      }),
    ).toEqual({
      restrictToRoles: false,
      allowedRoleIds: ['editor'],
      restrictToModels: false,
      allowedModelIds: ['article'],
    });
  });
});
