import type { ItemType, RenderInspectorCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_DETAILS_MODAL_ID } from './fileDetailsModal';
import { clearSessionLocalFiles, registerLocalFile } from './localFiles';
import { createAgentMentionHost } from './mentionHost';

const cmaMocks = vi.hoisted(() => ({
  createUpload: vi.fn(),
  findItem: vi.fn(),
  findUpload: vi.fn(),
}));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(() => ({
    items: { find: cmaMocks.findItem },
    uploads: {
      createFromFileOrBlob: cmaMocks.createUpload,
      find: cmaMocks.findUpload,
    },
  })),
}));

function cancelableResult<T>(value: T) {
  const promise = Promise.resolve(value) as Promise<T> & { cancel(): void };
  promise.cancel = vi.fn();
  return promise;
}

function itemType(
  id: string,
  name: string,
  options: { singleton?: boolean } = {},
): ItemType {
  return {
    id,
    type: 'item_type',
    attributes: {
      api_key: id,
      name,
      modular_block: false,
      singleton: options.singleton ?? false,
      collection_appearance: 'table',
    },
    relationships: {
      presentation_title_field: { data: null },
      title_field: { data: null },
      presentation_image_field: { data: null },
      image_preview_field: { data: null },
    },
  } as unknown as ItemType;
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
    openConfirm: vi.fn().mockResolvedValue('create'),
    openModal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderInspectorCtx;
}

afterEach(() => {
  clearSessionLocalFiles();
  vi.clearAllMocks();
});

describe('createAgentMentionHost', () => {
  it('opens session-local file details without treating the registry ID as an asset ID', async () => {
    const openModal = vi.fn().mockResolvedValue(undefined);
    const host = createAgentMentionHost(createContext({ openModal }));
    const mention = registerLocalFile(
      new File(['file bytes'], 'brief.pdf', {
        type: 'application/pdf',
        lastModified: 1_786_000_000_000,
      }),
    );

    await host.openLocalFile(mention);

    expect(openModal).toHaveBeenCalledWith({
      id: FILE_DETAILS_MODAL_ID,
      title: 'File details',
      width: 'm',
      initialHeight: 400,
      parameters: {
        id: mention.id,
        filename: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 10,
        lastModified: 1_786_000_000_000,
        bytesAvailable: true,
      },
    });
  });

  it('resolves authoritative record and asset presentation through the current-user CMA client', async () => {
    const article = itemType('article', 'Article');
    article.relationships.presentation_title_field.data = {
      id: 'title-field',
      type: 'field',
    };
    article.relationships.presentation_image_field.data = {
      id: 'image-field',
      type: 'field',
    };
    const fields = [
      {
        id: 'title-field',
        type: 'field',
        attributes: {
          api_key: 'title',
          label: 'Title',
          field_type: 'string',
          localized: false,
          position: 1,
          appearance: { editor: 'single_line' },
        },
        relationships: {
          item_type: { data: { id: 'article', type: 'item_type' } },
        },
      },
      {
        id: 'image-field',
        type: 'field',
        attributes: {
          api_key: 'image',
          label: 'Image',
          field_type: 'file',
          localized: false,
          position: 2,
          appearance: { editor: 'file' },
        },
        relationships: {
          item_type: { data: { id: 'article', type: 'item_type' } },
        },
      },
    ];
    cmaMocks.findItem.mockResolvedValue({
      id: 'record-1',
      item_type: { id: 'article', type: 'item_type' },
      title: 'Authoritative title',
      image: { upload_id: 'upload-1' },
    });
    cmaMocks.findUpload.mockImplementation(async (id: string) => ({
      id,
      filename: id === 'upload-1' ? 'preview.jpg' : 'asset.pdf',
      mime_type: id === 'upload-1' ? 'image/jpeg' : 'application/pdf',
      url: `https://cdn.example/${id}`,
    }));
    const host = createAgentMentionHost(
      createContext({
        itemTypes: { article },
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        loadItemTypeFields: vi.fn().mockResolvedValue(fields),
      }),
    );

    await expect(
      host.resolveRecord({
        itemId: 'record-1',
        label: 'Record record-1',
      }),
    ).resolves.toMatchObject({
      id: 'record-1',
      title: 'Authoritative title',
      modelId: 'article',
      modelApiKey: 'article',
      modelName: 'Article',
      thumbnailUrl:
        'https://cdn.example/upload-1?w=48&fit=max&auto=format&dpr=2&q=80',
    });
    await expect(
      host.resolveAsset({ uploadId: 'upload-2', label: 'Asset upload-2' }),
    ).resolves.toMatchObject({
      id: 'upload-2',
      filename: 'asset.pdf',
      mimeType: 'application/pdf',
    });

    await host.resolveRecord({ itemId: 'record-1' });
    expect(cmaMocks.findItem).toHaveBeenCalledTimes(1);
  });

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
    expect(host.canCreateAssets).toBe(false);
    expect(host.createAsset).toBeUndefined();
  });

  it('creates an asset from an attached file only after native confirmation', async () => {
    const openConfirm = vi.fn().mockResolvedValue('create');
    cmaMocks.createUpload.mockReturnValue(
      cancelableResult({
        id: 'new-upload',
        filename: 'brief.pdf',
        mime_type: 'application/pdf',
        mux_playback_id: null,
        url: 'https://cdn.example/new-upload',
      }),
    );
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        openConfirm,
        currentRole: {
          attributes: {
            positive_upload_permissions: [],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: {
            final_permissions: {
              can_edit_schema: false,
              positive_upload_permissions: [
                { environment: 'main', action: 'create' },
              ],
              negative_upload_permissions: [],
            },
          },
        },
      }),
    );
    const file = new File(['PDF'], 'brief.pdf', {
      type: 'application/pdf',
    });

    expect(host.canCreateAssets).toBe(true);
    await expect(
      host.createAsset?.({
        source: 'file',
        fileOrBlob: file,
        filename: file.name,
      }),
    ).resolves.toMatchObject({
      type: 'asset',
      id: 'new-upload',
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
    });
    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Create this asset?',
        choices: [
          expect.objectContaining({
            label: 'Create asset',
            value: 'create',
            intent: 'positive',
          }),
        ],
      }),
    );
    expect(cmaMocks.createUpload).toHaveBeenCalledWith({
      fileOrBlob: file,
      filename: 'brief.pdf',
    });
  });

  it('does not create an asset when the editor cancels confirmation', async () => {
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        openConfirm: vi.fn().mockResolvedValue('cancel'),
        currentRole: {
          attributes: {
            positive_upload_permissions: [
              { environment: 'main', action: 'create' },
            ],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: { final_permissions: { can_edit_schema: false } },
        },
      }),
    );

    await expect(
      host.createAsset?.({
        source: 'file',
        fileOrBlob: new Blob(['content']),
        filename: 'notes.txt',
      }),
    ).rejects.toThrow('Asset creation was cancelled.');
    expect(cmaMocks.createUpload).not.toHaveBeenCalled();
  });

  it('does not start an upload if the chat is stopped while confirmation is open', async () => {
    let resolveConfirmation: (choice: string) => void = () => undefined;
    const openConfirm = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        openConfirm,
        currentRole: {
          attributes: {
            positive_upload_permissions: [],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: {
            final_permissions: {
              can_edit_schema: false,
              positive_upload_permissions: [
                { environment: 'main', action: 'create' },
              ],
              negative_upload_permissions: [],
            },
          },
        },
      }),
    );
    const controller = new AbortController();
    const creation = host.createAsset?.(
      {
        source: 'file',
        fileOrBlob: new File(['content'], 'notes.txt'),
        filename: 'notes.txt',
      },
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(openConfirm).toHaveBeenCalledOnce());
    controller.abort();
    resolveConfirmation('create');

    await expect(creation).rejects.toMatchObject({ name: 'AbortError' });
    expect(cmaMocks.createUpload).not.toHaveBeenCalled();
  });

  it('downloads an explicit HTTP URL in the browser and creates the asset through the CMA client', async () => {
    const openConfirm = vi.fn().mockResolvedValue('create');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('image bytes', {
        headers: { 'content-type': 'image/png' },
      }),
    );
    cmaMocks.createUpload.mockImplementation(
      ({ fileOrBlob, filename }: { fileOrBlob: Blob; filename: string }) =>
        cancelableResult({
          id: 'url-upload',
          filename,
          mime_type: fileOrBlob.type,
          mux_playback_id: null,
          url: 'https://cdn.example/url-upload',
        }),
    );
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        openConfirm,
        currentRole: {
          attributes: {
            positive_upload_permissions: [],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: {
            final_permissions: {
              can_edit_schema: false,
              positive_upload_permissions: [
                { environment: 'main', action: 'create' },
              ],
              negative_upload_permissions: [],
            },
          },
        },
      }),
    );

    await expect(
      host.createAsset?.(
        {
          source: 'url',
          url: 'https://assets.example/folder/hero%20image.png',
        },
        { skipConfirmation: true },
      ),
    ).resolves.toMatchObject({
      id: 'url-upload',
      filename: 'hero image.png',
      mimeType: 'image/png',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('https://assets.example/folder/hero%20image.png'),
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
      }),
    );
    expect(openConfirm).not.toHaveBeenCalled();
    expect(cmaMocks.createUpload).toHaveBeenCalledWith({
      fileOrBlob: expect.objectContaining({
        size: 11,
        type: 'image/png',
      }),
      filename: 'hero image.png',
    });
  });

  it('rejects a declared oversized URL response before reading or creating it', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('must not be read'));
        controller.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        headers: { 'content-length': String(50 * 1024 * 1024 + 1) },
      }),
    );
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        currentRole: {
          attributes: {
            positive_upload_permissions: [],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: {
            final_permissions: {
              can_edit_schema: false,
              positive_upload_permissions: [
                { environment: 'main', action: 'create' },
              ],
              negative_upload_permissions: [],
            },
          },
        },
      }),
    );

    await expect(
      host.createAsset?.(
        {
          source: 'url',
          url: 'https://assets.example/too-large.bin',
        },
        { skipConfirmation: true },
      ),
    ).rejects.toThrow('50 MB or smaller');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(cmaMocks.createUpload).not.toHaveBeenCalled();
  });

  it('does not fetch a URL until the editor confirms the download', async () => {
    const openConfirm = vi.fn().mockResolvedValue('cancel');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        openConfirm,
        currentRole: {
          attributes: {
            positive_upload_permissions: [],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: {
            final_permissions: {
              can_edit_schema: false,
              positive_upload_permissions: [
                { environment: 'main', action: 'create' },
              ],
              negative_upload_permissions: [],
            },
          },
        },
      }),
    );

    await expect(
      host.createAsset?.({
        source: 'url',
        url: 'https://assets.example/folder/hero.png',
      }),
    ).rejects.toThrow('Asset creation was cancelled.');
    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('assets.example'),
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cmaMocks.createUpload).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://10.0.0.8/asset.png',
    'http://[::1]/asset.png',
  ])('rejects a local or private URL before fetching: %s', async (url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const host = createAgentMentionHost(
      createContext({
        currentUserAccessToken: 'user-token',
        cmaBaseUrl: 'https://site-api.datocms.com',
        currentRole: {
          attributes: {
            positive_upload_permissions: [],
            negative_upload_permissions: [],
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
          meta: {
            final_permissions: {
              can_edit_schema: false,
              positive_upload_permissions: [
                { environment: 'main', action: 'create' },
              ],
              negative_upload_permissions: [],
            },
          },
        },
      }),
    );

    await expect(
      host.createAsset?.({ source: 'url', url }, { skipConfirmation: true }),
    ).rejects.toThrow('private network');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cmaMocks.createUpload).not.toHaveBeenCalled();
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
