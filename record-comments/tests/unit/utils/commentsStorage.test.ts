import { describe, expect, it, vi } from 'vitest';
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
    },
  };
}

function createFieldList(apiKeys: string[]) {
  return apiKeys.map((apiKey) => ({ id: `field-${apiKey}`, api_key: apiKey }));
}

describe('ensureCommentsModelExists', () => {
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
    } as never);

    expect(result).toBe('comments-model');
    expect(createApiClient).toHaveBeenCalledWith('token', 'sandbox-env');
  });
});

describe('ensureCommentsModelExistsWithClient', () => {
  it('repairs missing required fields on an existing model', async () => {
    const client = createClientMock();
    client.itemTypes.list.mockResolvedValue([
      { id: 'comments-model', api_key: COMMENTS_MODEL_API_KEY },
    ]);
    client.fields.list.mockResolvedValue([
      { id: 'field-model', api_key: COMMENT_FIELDS.MODEL_ID },
    ]);
    client.fields.create.mockImplementation(async (_itemTypeId, body) => ({
      id: `created-${body.api_key}`,
      api_key: body.api_key,
    }));

    const result = await ensureCommentsModelExistsWithClient(client);

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

    const result = await ensureCommentsModelExistsWithClient(client);

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
      .mockResolvedValueOnce([
        { id: 'field-model', api_key: COMMENT_FIELDS.MODEL_ID },
      ])
      .mockResolvedValueOnce([
        { id: 'field-model', api_key: COMMENT_FIELDS.MODEL_ID },
        { id: 'field-record', api_key: COMMENT_FIELDS.RECORD_ID },
      ]);
    client.fields.create.mockImplementation(async (_itemTypeId, body) => ({
      id: `created-${body.api_key}`,
      api_key: body.api_key,
    }));
    client.fields.create.mockRejectedValueOnce(new Error('duplicate field'));

    const result = await ensureCommentsModelExistsWithClient(client);

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
});
