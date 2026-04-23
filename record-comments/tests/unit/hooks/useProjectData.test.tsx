// @vitest-environment jsdom

import { useProjectData } from '@hooks/useProjectData';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, renderHook } from '../testUtils/react';

function createCtx(loadItemTypeFields = vi.fn().mockResolvedValue([])) {
  return {
    itemType: { id: 'model-1' },
    itemTypes: {},
    formValues: {},
    site: { id: 'site-1', attributes: { locales: ['en'] } },
    currentUser: {
      id: 'current-user',
      attributes: { email: 'current@example.com' },
    },
    owner: {
      id: 'owner-1',
      type: 'account',
      attributes: { email: 'owner@example.com' },
    },
    loadUsers: vi.fn().mockResolvedValue([]),
    loadSsoUsers: vi.fn().mockResolvedValue([]),
    loadItemTypeFields,
  } as never;
}

describe('useProjectData', () => {
  it('does not load field metadata until field mentions are requested', async () => {
    const loadItemTypeFields = vi.fn().mockResolvedValue([]);
    const ctx = createCtx(loadItemTypeFields);
    let loadFields = false;

    const { rerender, unmount } = renderHook(() =>
      useProjectData(ctx, { loadFields }),
    );

    await flushPromises();
    expect(loadItemTypeFields).not.toHaveBeenCalled();

    loadFields = true;
    rerender();
    await flushPromises();

    expect(loadItemTypeFields).toHaveBeenCalledTimes(1);
    expect(loadItemTypeFields).toHaveBeenCalledWith('model-1');

    rerender();
    await flushPromises();

    expect(loadItemTypeFields).toHaveBeenCalledTimes(1);
    unmount();
  });
});
