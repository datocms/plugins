import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createAgentMentionHost } from './mentionHost';

function itemType(
  id: string,
  name: string,
  options: { singleton?: boolean } = {},
) {
  return {
    id,
    type: 'item_type',
    attributes: {
      api_key: id,
      name,
      modular_block: false,
      singleton: options.singleton ?? false,
    },
    relationships: {
      presentation_title_field: { data: null },
      title_field: { data: null },
    },
  };
}

function createContext(
  overrides: Record<string, unknown> = {},
): RenderInspectorCtx {
  return {
    environment: 'main',
    isEnvironmentPrimary: true,
    currentUser: {
      id: 'editor',
      type: 'user',
      attributes: {
        email: 'editor@example.com',
        full_name: 'Editor Example',
      },
    },
    owner: {
      id: 'owner',
      type: 'account',
      attributes: {
        email: 'owner@example.com',
        first_name: 'Project',
        last_name: 'Owner',
      },
    },
    currentRole: {
      attributes: {
        positive_upload_permissions: [{ environment: 'main', action: 'read' }],
        negative_upload_permissions: [],
        positive_item_type_permissions: [
          { environment: 'main', action: 'read', item_type: null },
        ],
        negative_item_type_permissions: [],
      },
      meta: { final_permissions: { can_edit_schema: true } },
    },
    site: {
      attributes: {
        internal_domain: 'example.admin.datocms.com',
        locales: ['en'],
      },
    },
    itemTypes: {},
    loadUsers: vi.fn().mockResolvedValue([]),
    loadSsoUsers: vi.fn().mockResolvedValue([]),
    loadItemTypeFields: vi.fn().mockResolvedValue([]),
    selectItem: vi.fn().mockResolvedValue(undefined),
    selectUpload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderInspectorCtx;
}

describe('createAgentMentionHost', () => {
  it('matches Record Comments permissions for assets, schemas, and readable records', () => {
    const modelA = itemType('article', 'Article');
    const modelB = itemType('secret', 'Secret');
    const ctx = createContext({
      itemTypes: { article: modelA, secret: modelB },
      currentRole: {
        attributes: {
          positive_upload_permissions: [],
          negative_upload_permissions: [],
          positive_item_type_permissions: [
            { environment: 'main', action: 'read', item_type: 'article' },
          ],
          negative_item_type_permissions: [],
        },
        meta: { final_permissions: { can_edit_schema: false } },
      },
    });

    const host = createAgentMentionHost(ctx);

    expect(host.projectModels.map((model) => model.id)).toEqual([
      'article',
      'secret',
    ]);
    expect(host.recordModels.map((model) => model.id)).toEqual(['article']);
    expect(host.canMentionAssets).toBe(false);
    expect(host.canMentionModels).toBe(false);
  });

  it('preserves SSO identity, deduplicates it, and opens the SSO directory', async () => {
    const currentSso = {
      id: 'sso-editor',
      type: 'sso_user',
      attributes: {
        username: 'sso@example.com',
        first_name: 'Sso',
        last_name: 'Editor',
      },
    };
    const ctx = createContext({
      currentUser: currentSso,
      loadSsoUsers: vi.fn().mockResolvedValue([currentSso]),
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = createAgentMentionHost(ctx);

    expect(host.currentUser).toMatchObject({
      id: 'sso-editor',
      name: 'Sso Editor',
      userType: 'sso',
    });
    const users = await host.loadProjectUsers();
    expect(users.filter((user) => user.id === 'sso-editor')).toHaveLength(1);

    host.openUser('sso-editor');
    expect(open).toHaveBeenCalledWith(
      'https://example.admin.datocms.com/project_settings/sso-users',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('allows a user-directory load to be retried after both sources fail', async () => {
    const loadUsers = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce([]);
    const loadSsoUsers = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce([]);
    const host = createAgentMentionHost(
      createContext({ loadUsers, loadSsoUsers }),
    );

    await expect(host.loadProjectUsers()).rejects.toThrow(
      'DatoCMS users could not be loaded.',
    );
    await expect(host.loadProjectUsers()).resolves.toEqual([
      expect.objectContaining({ id: 'owner', userType: 'owner' }),
      expect.objectContaining({ id: 'editor', userType: 'user' }),
    ]);
  });

  it('keeps a selected record when its fields cannot load', async () => {
    const singleton = itemType('home', 'Homepage', { singleton: true });
    const host = createAgentMentionHost(
      createContext({
        itemTypes: { home: singleton },
        selectItem: vi.fn().mockResolvedValue({
          id: 'homepage',
          attributes: {},
        }),
        loadItemTypeFields: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    );

    await expect(
      host.selectRecord(host.recordModels[0]),
    ).resolves.toMatchObject({
      id: 'homepage',
      title: 'Homepage',
      modelId: 'home',
      isSingleton: true,
    });
  });
});
