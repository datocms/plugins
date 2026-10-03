import type { buildClient } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import { CmaRequestScheduler } from './cmaRequests';
import { ensureRecordBinModel } from './recordBinModel';

type FieldFixture = {
  id: string;
  api_key: string;
  field_type: string;
  localized?: boolean;
};

const requiredFields = (): FieldFixture[] => [
  { id: 'label-id', api_key: 'label', field_type: 'string' },
  { id: 'model-id', api_key: 'model', field_type: 'string' },
  {
    id: 'date-id',
    api_key: 'date_of_deletion',
    field_type: 'date_time',
  },
  { id: 'body-id', api_key: 'record_body', field_type: 'json' },
];

const notFound = { response: { status: 404 } };

const createClient = () => ({
  itemTypes: {
    find: vi.fn().mockResolvedValue({
      id: 'bin-id',
      title_field: { id: 'label-id', type: 'field' },
    }),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: 'bin-id' }),
  },
  fields: {
    list: vi.fn().mockResolvedValue(requiredFields()),
    create: vi
      .fn()
      .mockImplementation(
        async (_modelId: string, definition: FieldFixture) => ({
          ...definition,
          id: `${definition.api_key}-created`,
        }),
      ),
  },
});

const asClient = (client: ReturnType<typeof createClient>) =>
  client as unknown as ReturnType<typeof buildClient>;

describe('ensureRecordBinModel', () => {
  it('uses the shared scheduler for reads and writes when supplied', async () => {
    const client = createClient();
    client.itemTypes.find.mockResolvedValue({ id: 'bin-id' });
    client.fields.list.mockResolvedValue(requiredFields().slice(0, 3));
    const scheduler = new CmaRequestScheduler(0);
    const beforeRequest = vi.spyOn(scheduler, 'beforeRequest');

    await ensureRecordBinModel(asClient(client), { scheduler });
    expect(beforeRequest).toHaveBeenCalledTimes(4);
    expect(client.fields.create).toHaveBeenCalledTimes(1);
    expect(client.itemTypes.update).toHaveBeenCalledTimes(1);
  });

  it('retries a rate-limited schema read without creating another model', async () => {
    const client = createClient();
    client.itemTypes.find.mockRejectedValueOnce({
      response: { status: 429, headers: { 'x-ratelimit-reset': '0' } },
    });

    await expect(
      ensureRecordBinModel(asClient(client), {
        scheduler: new CmaRequestScheduler(0),
      }),
    ).resolves.toEqual({ id: 'bin-id' });
    expect(client.itemTypes.find).toHaveBeenCalledTimes(2);
    expect(client.itemTypes.create).not.toHaveBeenCalled();
  });

  it('checks cancellation before any read or schema mutation', async () => {
    const client = createClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      ensureRecordBinModel(asClient(client), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.itemTypes.find).not.toHaveBeenCalled();

    const duringRead = new AbortController();
    client.fields.list.mockImplementation(async () => {
      duringRead.abort();
      return [];
    });
    await expect(
      ensureRecordBinModel(asClient(client), { signal: duringRead.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.fields.create).not.toHaveBeenCalled();
    expect(client.itemTypes.update).not.toHaveBeenCalled();
  });

  it('keeps an existing compatible schema and user customization untouched', async () => {
    const client = createClient();
    client.itemTypes.find.mockResolvedValue({
      id: 'bin-id',
      title_field: { id: 'custom-title', type: 'field' },
      collection_appearance: 'gallery',
    });
    client.fields.list.mockResolvedValue([
      ...requiredFields(),
      { id: 'custom-title', api_key: 'extra_title', field_type: 'string' },
    ]);

    await expect(ensureRecordBinModel(asClient(client))).resolves.toEqual({
      id: 'bin-id',
    });
    expect(client.itemTypes.create).not.toHaveBeenCalled();
    expect(client.itemTypes.update).not.toHaveBeenCalled();
    expect(client.fields.create).not.toHaveBeenCalled();
    expect(client.fields.list).toHaveBeenCalledWith('bin-id');
  });

  it.each([401, 403, 429, 500])(
    'does not create a model when its read fails with HTTP %s',
    async (status) => {
      const client = createClient();
      const error = { response: { status } };
      client.itemTypes.find.mockRejectedValue(error);

      await expect(ensureRecordBinModel(asClient(client))).rejects.toBe(error);
      expect(client.itemTypes.create).not.toHaveBeenCalled();
      expect(client.fields.list).not.toHaveBeenCalled();
    },
  );

  it('creates the complete schema only after a confirmed missing model', async () => {
    const client = createClient();
    client.itemTypes.find.mockRejectedValue(notFound);
    client.itemTypes.create.mockResolvedValue({ id: 'new-bin' });
    client.fields.list.mockResolvedValue([]);

    await expect(ensureRecordBinModel(asClient(client))).resolves.toEqual({
      id: 'new-bin',
    });
    expect(client.itemTypes.create).toHaveBeenCalledTimes(1);
    expect(
      client.fields.create.mock.calls.map((call) => call[1].api_key),
    ).toEqual(['label', 'model', 'date_of_deletion', 'record_body']);
    expect(client.itemTypes.update).toHaveBeenCalledWith('new-bin', {
      title_field: { type: 'field', id: 'label-created' },
    });
  });

  it('repairs a partially initialized existing model before allowing capture', async () => {
    const client = createClient();
    client.itemTypes.find.mockResolvedValue({
      id: 'bin-id',
      title_field: null,
    });
    client.fields.list.mockResolvedValue(requiredFields().slice(0, 2));

    await ensureRecordBinModel(asClient(client));
    expect(
      client.fields.create.mock.calls.map((call) => call[1].api_key),
    ).toEqual(['date_of_deletion', 'record_body']);
    expect(client.itemTypes.update).toHaveBeenCalledWith('bin-id', {
      title_field: { type: 'field', id: 'label-id' },
    });
  });

  it('reconciles a model committed by another initialization after a failed create', async () => {
    const client = createClient();
    client.itemTypes.find.mockRejectedValueOnce(notFound);
    client.itemTypes.create.mockRejectedValue(new Error('conflicting create'));
    client.fields.list.mockResolvedValue(requiredFields().slice(0, 3));

    await expect(ensureRecordBinModel(asClient(client))).resolves.toEqual({
      id: 'bin-id',
    });
    expect(client.itemTypes.find).toHaveBeenCalledTimes(2);
    expect(client.itemTypes.create).toHaveBeenCalledTimes(1);
    expect(client.fields.create).toHaveBeenCalledTimes(1);
    expect(client.fields.create).toHaveBeenCalledWith(
      'bin-id',
      expect.objectContaining({ api_key: 'record_body', field_type: 'json' }),
    );
  });

  it('reconciles a field committed before its create response was lost without replaying it', async () => {
    const client = createClient();
    client.fields.list
      .mockResolvedValueOnce(requiredFields().slice(0, 3))
      .mockResolvedValueOnce(requiredFields());
    client.fields.create.mockRejectedValue(new Error('timed out after commit'));

    await expect(ensureRecordBinModel(asClient(client))).resolves.toEqual({
      id: 'bin-id',
    });
    expect(client.fields.create).toHaveBeenCalledTimes(1);
    expect(client.fields.list).toHaveBeenCalledTimes(2);
  });

  it('rejects a field creation that cannot be reconciled', async () => {
    const client = createClient();
    const error = new Error('field not created');
    client.fields.list.mockResolvedValue(requiredFields().slice(0, 3));
    client.fields.create.mockRejectedValue(error);

    await expect(ensureRecordBinModel(asClient(client))).rejects.toBe(error);
    expect(client.fields.create).toHaveBeenCalledTimes(1);
    expect(client.itemTypes.update).not.toHaveBeenCalled();
  });

  it.each([
    { field_type: 'text' },
    { field_type: 'json', localized: true },
    { field_type: 'json', id: '' },
  ])(
    'rejects incompatible record_body without changing the schema: %j',
    async (override) => {
      const client = createClient();
      client.fields.list.mockResolvedValue([
        { id: 'body-id', api_key: 'record_body', ...override },
      ]);

      await expect(ensureRecordBinModel(asClient(client))).rejects.toThrow(
        'Record Bin field record_body must be a non-localized json field.',
      );
      expect(client.fields.create).not.toHaveBeenCalled();
      expect(client.itemTypes.update).not.toHaveBeenCalled();
    },
  );

  it.each([{ singleton: true }, { modular_block: true }])(
    'rejects an incompatible model instead of recreating it: %j',
    async (override) => {
      const client = createClient();
      client.itemTypes.find.mockResolvedValue({ id: 'bin-id', ...override });

      await expect(ensureRecordBinModel(asClient(client))).rejects.toThrow(
        'regular collection model',
      );
      expect(client.itemTypes.create).not.toHaveBeenCalled();
      expect(client.fields.list).not.toHaveBeenCalled();
    },
  );

  it('does not interpret malformed model or field responses as missing schema', async () => {
    const client = createClient();
    client.itemTypes.find.mockResolvedValue({});
    await expect(ensureRecordBinModel(asClient(client))).rejects.toThrow(
      'invalid model id',
    );
    expect(client.itemTypes.create).not.toHaveBeenCalled();

    client.itemTypes.find.mockResolvedValue({ id: 'bin-id' });
    client.fields.list.mockResolvedValue(undefined);
    await expect(ensureRecordBinModel(asClient(client))).rejects.toThrow(
      'fields could not be read',
    );
    expect(client.fields.create).not.toHaveBeenCalled();
  });

  it('rejects a race that creates the required api key with an incompatible type', async () => {
    const client = createClient();
    client.fields.list
      .mockResolvedValueOnce(requiredFields().slice(0, 3))
      .mockResolvedValueOnce([
        ...requiredFields().slice(0, 3),
        { id: 'wrong-body', api_key: 'record_body', field_type: 'text' },
      ]);
    client.fields.create.mockRejectedValue(new Error('conflict'));

    await expect(ensureRecordBinModel(asClient(client))).rejects.toThrow(
      'Record Bin field record_body must be a non-localized json field.',
    );
    expect(client.fields.create).toHaveBeenCalledTimes(1);
  });
});
