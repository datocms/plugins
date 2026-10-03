import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMENT_FIELDS, COMMENTS_MODEL_API_KEY } from '@/constants';
import { createApiClient } from '@/utils/cmaClient';
import {
  ensureCommentsModelExists,
  ensureCommentsModelExistsWithClient,
} from '@/utils/commentsStorage';

vi.mock('@/utils/cmaClient', () => ({
  createApiClient: vi.fn(),
}));

function createClientMock() {
  return {
    itemTypes: {
      list: vi.fn(),
      create: vi.fn(),
    },
    fields: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      destroy: vi.fn(),
    },
  };
}

function createFieldList(apiKeys: string[]) {
  return apiKeys.map((apiKey) => ({
    id: `field-${apiKey}`,
    api_key: apiKey,
    localized: false,
    field_type: apiKey === COMMENT_FIELDS.CONTENT ? 'json' : 'string',
    validators: {
      required: {},
      ...(apiKey === COMMENT_FIELDS.RECORD_ID && { unique: {} }),
    },
  }));
}

function asStorageClient(client: ReturnType<typeof createClientMock>) {
  // The double supplies the only methods used by commentsStorage, while the
  // public SDK type also requires unrelated resource methods.
  return client as unknown as Parameters<
    typeof ensureCommentsModelExistsWithClient
  >[0];
}

describe('ensureCommentsModelExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no CMA token is available', async () => {
    const result = await ensureCommentsModelExists({
      currentUserAccessToken: null,
    } as never);

    expect(result).toBeNull();
  });

  it('builds the CMA client with the current environment', async () => {
    const client = createClientMock();
    client.itemTypes.list.mockResolvedValue([
      { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
    ]);
    client.fields.list.mockResolvedValue(
      createFieldList([
        COMMENT_FIELDS.MODEL_ID,
        COMMENT_FIELDS.RECORD_ID,
        COMMENT_FIELDS.CONTENT,
      ]),
    );
    vi.mocked(createApiClient).mockReturnValue(client as never);

    const result = await ensureCommentsModelExists({
      currentUserAccessToken: 'token',
      environment: 'sandbox-env',
      cmaBaseUrl: 'https://example.com',
    } as never);

    expect(result).toBe('comments-model');
    expect(createApiClient).toHaveBeenCalledWith(
      'token',
      'sandbox-env',
      'https://example.com',
    );
  });
});

describe('ensureCommentsModelExistsWithClient', () => {
  it('repairs missing required fields on an existing model', async () => {
    const client = createClientMock();
    client.itemTypes.list.mockResolvedValue([
      { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
    ]);
    client.fields.list.mockResolvedValue(
      createFieldList([COMMENT_FIELDS.MODEL_ID]),
    );
    client.fields.create.mockImplementation(async (_itemTypeId, body) => ({
      id: `created-${body.api_key}`,
      ...body,
      localized: false,
    }));

    const result = await ensureCommentsModelExistsWithClient(
      asStorageClient(client),
    );

    expect(result).toBe('comments-model');
    expect(client.itemTypes.create).not.toHaveBeenCalled();
    expect(client.fields.create).toHaveBeenCalledTimes(2);
    expect(client.fields.create).toHaveBeenCalledWith(
      'comments-model',
      expect.objectContaining({
        api_key: COMMENT_FIELDS.RECORD_ID,
        validators: { required: {}, unique: {} },
      }),
    );
    expect(client.fields.create).toHaveBeenCalledWith(
      'comments-model',
      expect.objectContaining({
        api_key: COMMENT_FIELDS.CONTENT,
        validators: { required: {} },
      }),
    );
  });

  it('recovers from a concurrent model creation race by re-fetching the model', async () => {
    const client = createClientMock();
    client.itemTypes.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
      ]);
    client.itemTypes.create.mockRejectedValue(new Error('duplicate model'));
    client.fields.list.mockResolvedValue(
      createFieldList([
        COMMENT_FIELDS.MODEL_ID,
        COMMENT_FIELDS.RECORD_ID,
        COMMENT_FIELDS.CONTENT,
      ]),
    );

    const result = await ensureCommentsModelExistsWithClient(
      asStorageClient(client),
    );

    expect(result).toBe('comments-model');
    expect(client.itemTypes.create).toHaveBeenCalledWith({
      name: 'Project Comment',
      api_key: COMMENTS_MODEL_API_KEY,
      draft_mode_active: false,
    });
  });

  it('recovers from a concurrent field creation race by re-fetching fields', async () => {
    const client = createClientMock();
    client.itemTypes.list.mockResolvedValue([
      { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
    ]);
    client.fields.list
      .mockResolvedValueOnce(createFieldList([COMMENT_FIELDS.MODEL_ID]))
      .mockResolvedValueOnce(
        createFieldList([COMMENT_FIELDS.MODEL_ID, COMMENT_FIELDS.RECORD_ID]),
      );
    client.fields.create.mockImplementation(async (_itemTypeId, body) => ({
      id: `created-${body.api_key}`,
      ...body,
      localized: false,
    }));
    client.fields.create.mockRejectedValueOnce(new Error('duplicate field'));

    const result = await ensureCommentsModelExistsWithClient(
      asStorageClient(client),
    );

    expect(result).toBe('comments-model');
    expect(client.fields.create).toHaveBeenCalledWith(
      'comments-model',
      expect.objectContaining({ api_key: COMMENT_FIELDS.RECORD_ID }),
    );
    expect(client.fields.create).toHaveBeenCalledWith(
      'comments-model',
      expect.objectContaining({ api_key: COMMENT_FIELDS.CONTENT }),
    );
  });

  it.each([
    [COMMENT_FIELDS.MODEL_ID, { localized: true }],
    [COMMENT_FIELDS.MODEL_ID, { field_type: 'json' }],
    [COMMENT_FIELDS.RECORD_ID, { localized: true }],
    [COMMENT_FIELDS.RECORD_ID, { validators: { required: {} } }],
    [COMMENT_FIELDS.CONTENT, { localized: true }],
    [COMMENT_FIELDS.CONTENT, { field_type: 'string' }],
  ])('preserves incompatible existing %s fields without changing schema', async (apiKey, overrides) => {
    const client = createClientMock();
    client.itemTypes.list.mockResolvedValue([
      { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
    ]);
    const fields = createFieldList([String(apiKey)]).map((field) => ({
      ...field,
      ...overrides,
    }));
    const original = structuredClone(fields);
    client.fields.list.mockResolvedValue(fields);

    await expect(
      ensureCommentsModelExistsWithClient(asStorageClient(client)),
    ).rejects.toThrow('Existing fields were preserved');

    expect(fields).toEqual(original);
    expect(client.itemTypes.create).not.toHaveBeenCalled();
    expect(client.fields.create).not.toHaveBeenCalled();
    expect(client.fields.update).not.toHaveBeenCalled();
    expect(client.fields.destroy).not.toHaveBeenCalled();
  });

  it('rejects an incompatible field created by another session during recovery', async () => {
    const client = createClientMock();
    client.itemTypes.list.mockResolvedValue([
      { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
    ]);
    client.fields.list
      .mockResolvedValueOnce(createFieldList([COMMENT_FIELDS.MODEL_ID]))
      .mockResolvedValueOnce([
        ...createFieldList([COMMENT_FIELDS.MODEL_ID]),
        {
          ...createFieldList([COMMENT_FIELDS.RECORD_ID])[0],
          validators: {},
        },
      ]);
    client.fields.create.mockRejectedValue(new Error('duplicate field'));

    await expect(
      ensureCommentsModelExistsWithClient(asStorageClient(client)),
    ).rejects.toThrow('unique validator');

    expect(client.fields.create).toHaveBeenCalledTimes(1);
    expect(client.fields.update).not.toHaveBeenCalled();
    expect(client.fields.destroy).not.toHaveBeenCalled();
  });
});
