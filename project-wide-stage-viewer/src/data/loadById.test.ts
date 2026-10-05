import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import { loadItemsById, loadUploadsById } from './loadById';

describe('reference hydration', () => {
  it.each(['items', 'uploads'] as const)(
    'bounds %s hydration and completes short pages',
    async (resource) => {
      let active = 0;
      let peak = 0;
      const rawList = vi.fn().mockImplementation(async (query) => {
        const ids: string[] = query.filter.ids.split(',');
        expect(ids.length).toBeLessThanOrEqual(100);
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return {
          data: ids
            .slice(query.page.offset, query.page.offset + 30)
            .map((id) => ({ id })),
          meta: { total_count: ids.length },
        };
      });
      const client = {
        items: { rawList },
        uploads: { rawList },
      } as unknown as Client;
      const ids = Array.from({ length: 10_000 }, (_, index) => `id-${index}`);
      const load = resource === 'items' ? loadItemsById : loadUploadsById;
      const result = await load(client, [...ids, ids[0]]);
      expect(result.map((item) => item.id)).toEqual(ids);
      expect(peak).toBeLessThanOrEqual(2);
      expect(rawList).toHaveBeenCalledTimes(400);
    },
  );

  it('does not mistake a premature empty page for completed hydration', async () => {
    const rawList = vi
      .fn()
      .mockResolvedValue({ data: [], meta: { total_count: 1 } });
    await expect(
      loadItemsById({ items: { rawList } } as unknown as Client, ['one']),
    ).rejects.toThrow();
  });
});
