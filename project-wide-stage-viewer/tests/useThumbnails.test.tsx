import type { Client } from '@datocms/cma-client-browser';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useThumbnails } from '../src/data/useThumbnails';

function clientWith(list: ReturnType<typeof vi.fn>) {
  return { uploads: { list } } as unknown as Client;
}

describe('useThumbnails', () => {
  it('keeps showing thumbnails while a reload fetches them again', async () => {
    let pending: (value: unknown) => void = () => {};
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'u1', is_image: true, url: 'https://img.test/old.jpg' },
      ])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            pending = resolve;
          }),
      );
    const client = clientWith(list);
    const { result, rerender } = renderHook(
      ({ resetKey }) => useThumbnails(() => client, resetKey, ['u1']),
      { initialProps: { resetKey: 1 } },
    );
    await waitFor(() => expect(result.current.get('u1')).toContain('old.jpg'));

    rerender({ resetKey: 2 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(result.current.get('u1')).toContain('old.jpg');

    pending([{ id: 'u1', is_image: true, url: 'https://img.test/new.jpg' }]);
    await waitFor(() => expect(result.current.get('u1')).toContain('new.jpg'));
  });

  it('asks again for thumbnails whose request failed', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([
        { id: 'u1', is_image: true, url: 'https://img.test/a.jpg' },
      ]);
    const client = clientWith(list);
    const { result, rerender } = renderHook(
      ({ ids }) => useThumbnails(() => client, 1, ids),
      { initialProps: { ids: ['u1'] } },
    );
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    // Paging away and back asks again.
    rerender({ ids: [] });
    rerender({ ids: ['u1'] });
    await waitFor(() => expect(result.current.get('u1')).toContain('a.jpg'));
  });
});
