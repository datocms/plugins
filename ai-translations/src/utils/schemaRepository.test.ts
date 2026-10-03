import { describe, expect, it, vi } from 'vitest';
import {
  buildFieldTypeDictionaryFromRepo,
  getBlockFieldsFromRepo,
  type SchemaRepository,
} from './schemaRepository';

function repository() {
  const getItemTypeById = vi.fn(async (id: string) => ({ id }));
  const getItemTypeFields = vi.fn(async () => [
    {
      api_key: 'title',
      id: 'field',
      localized: true,
      field_type: 'string',
      appearance: { editor: 'single_line' },
      validators: {},
    },
  ]);
  return {
    repo: { getItemTypeById, getItemTypeFields } as unknown as SchemaRepository,
    getItemTypeById,
    getItemTypeFields,
  };
}

describe('schema projections', () => {
  it('shares in-flight and resolved projections for repeated records of a model', async () => {
    const { repo, getItemTypeFields } = repository();
    const [first, second] = await Promise.all([
      buildFieldTypeDictionaryFromRepo(repo, 'model'),
      buildFieldTypeDictionaryFromRepo(repo, 'model'),
    ]);
    expect(first).toBe(second);
    for (let batch = 0; batch < 1000; batch++) {
      // biome-ignore lint/performance/noAwaitInLoops: Simulates incremental consumption without allocating records.
      expect(await buildFieldTypeDictionaryFromRepo(repo, 'model')).toBe(first);
    }
    expect(getItemTypeFields).toHaveBeenCalledTimes(1);
    expect(first.title.field_type).toBe('string');
  });

  it('shares block dictionaries and keeps repositories isolated', async () => {
    const a = repository();
    const b = repository();
    const first = await getBlockFieldsFromRepo(a.repo, 'block');
    expect(await getBlockFieldsFromRepo(a.repo, 'block')).toBe(first);
    expect(await getBlockFieldsFromRepo(b.repo, 'block')).not.toBe(first);
    expect(a.getItemTypeFields).toHaveBeenCalledTimes(1);
    expect(b.getItemTypeFields).toHaveBeenCalledTimes(1);
  });

  it('does not permanently cache rejected projections', async () => {
    const { repo, getItemTypeFields } = repository();
    getItemTypeFields.mockRejectedValueOnce(new Error('transient'));
    await expect(
      buildFieldTypeDictionaryFromRepo(repo, 'model'),
    ).rejects.toThrow('transient');
    await expect(
      buildFieldTypeDictionaryFromRepo(repo, 'model'),
    ).resolves.toHaveProperty('title');
    expect(getItemTypeFields).toHaveBeenCalledTimes(2);
  });
});
