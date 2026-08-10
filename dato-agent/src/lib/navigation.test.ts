import { describe, expect, it, vi } from 'vitest';
import { createInspectorNavigator, createSidebarNavigator } from './navigation';

describe('createInspectorNavigator', () => {
  it('uses the native record list and editor', async () => {
    const ctx = {
      editUpload: vi.fn().mockResolvedValue(null),
      setInspectorItemListData: vi.fn().mockResolvedValue(undefined),
      setInspectorMode: vi.fn().mockResolvedValue(undefined),
    };
    const navigator = createInspectorNavigator(ctx as never);
    expect(navigator.supportsRecordList).toBe(true);

    await navigator.showRecords({
      title: 'Recent posts',
      records: [{ itemId: 'a' }, { itemId: 'b' }, { itemId: 'a' }],
    });
    await navigator.openRecord({ itemId: 'a', fieldPath: 'title' });

    expect(ctx.setInspectorItemListData).toHaveBeenCalledWith({
      title: 'Recent posts',
      itemIds: ['a', 'b'],
    });
    expect(ctx.setInspectorMode).toHaveBeenLastCalledWith({
      type: 'itemEditor',
      itemId: 'a',
      fieldPath: 'title',
    });

    await expect(
      navigator.openAsset({ uploadId: 'upload-a' }),
    ).resolves.toEqual({ deleted: false });
    expect(ctx.editUpload).toHaveBeenCalledWith('upload-a');
  });

  it('reports when the native asset editor deletes an upload', async () => {
    const ctx = {
      editUpload: vi.fn().mockResolvedValue({ deleted: true }),
      setInspectorItemListData: vi.fn(),
      setInspectorMode: vi.fn(),
    };

    await expect(
      createInspectorNavigator(ctx as never).openAsset({
        uploadId: 'upload-a',
      }),
    ).resolves.toEqual({ deleted: true });
  });
});

describe('createSidebarNavigator', () => {
  it('scrolls to a field on the current record', async () => {
    const ctx = {
      editUpload: vi.fn(),
      fields: {},
      item: { id: 'current' },
      itemType: { id: 'post' },
      locale: 'en',
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'current',
      fieldPath: 'seo.title',
    });

    expect(ctx.scrollToField).toHaveBeenCalledWith('seo.title');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
    expect(createSidebarNavigator(ctx as never).supportsRecordList).toBe(false);
  });

  it('qualifies a localized top-level field with the active locale', async () => {
    const ctx = {
      editUpload: vi.fn(),
      fields: {
        title: {
          id: 'title',
          attributes: {
            api_key: 'title',
            localized: true,
          },
          relationships: {
            item_type: { data: { id: 'post' } },
          },
        },
      },
      item: { id: 'current' },
      itemType: { id: 'post' },
      locale: 'it',
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'current',
      fieldPath: 'title',
    });

    expect(ctx.scrollToField).toHaveBeenCalledWith('title.it', 'it');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it('resolves fields from the latest sidebar context state', async () => {
    const ctx = {
      editUpload: vi.fn(),
      fields: {},
      item: { id: 'current' },
      itemType: { id: 'post' },
      locale: 'en',
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };
    const navigator = createSidebarNavigator(ctx as never);

    ctx.fields = {
      title: {
        id: 'title',
        attributes: {
          api_key: 'title',
          localized: true,
        },
        relationships: {
          item_type: { data: { id: 'post' } },
        },
      },
    };
    ctx.locale = 'fr';

    await navigator.openRecord({
      itemId: 'current',
      fieldPath: 'title',
    });

    expect(ctx.scrollToField).toHaveBeenCalledWith('title.fr', 'fr');
  });

  it.each(['title.it', 'seo.title'])(
    'preserves the already-qualified or deep path %s',
    async (fieldPath) => {
      const ctx = {
        editUpload: vi.fn(),
        fields: {
          title: {
            id: 'title',
            attributes: {
              api_key: 'title',
              localized: true,
            },
            relationships: {
              item_type: { data: { id: 'post' } },
            },
          },
        },
        item: { id: 'current' },
        itemType: { id: 'post' },
        locale: 'it',
        scrollToField: vi.fn().mockResolvedValue(undefined),
        navigateTo: vi.fn(),
        editItem: vi.fn(),
      };

      await createSidebarNavigator(ctx as never).openRecord({
        itemId: 'current',
        fieldPath,
      });

      expect(ctx.scrollToField).toHaveBeenCalledWith(fieldPath);
    },
  );

  it('does not qualify a non-localized top-level field', async () => {
    const ctx = {
      editUpload: vi.fn(),
      fields: {
        slug: {
          id: 'slug',
          attributes: {
            api_key: 'slug',
            localized: false,
          },
          relationships: {
            item_type: { data: { id: 'post' } },
          },
        },
      },
      item: { id: 'current' },
      itemType: { id: 'post' },
      locale: 'it',
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'current',
      fieldPath: 'slug',
    });

    expect(ctx.scrollToField).toHaveBeenCalledWith('slug');
  });

  it('only resolves localized fields belonging to the current model', async () => {
    const ctx = {
      editUpload: vi.fn(),
      fields: {
        otherTitle: {
          id: 'other-title',
          attributes: {
            api_key: 'title',
            localized: true,
          },
          relationships: {
            item_type: { data: { id: 'page' } },
          },
        },
      },
      item: { id: 'current' },
      itemType: { id: 'post' },
      locale: 'it',
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'current',
      fieldPath: 'title',
    });

    expect(ctx.scrollToField).toHaveBeenCalledWith('title');
  });

  it('opens assets in the native upload modal without navigating away', async () => {
    const ctx = {
      editUpload: vi.fn().mockResolvedValue(null),
      item: { id: 'current' },
      scrollToField: vi.fn(),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await expect(
      createSidebarNavigator(ctx as never).openAsset({
        uploadId: 'upload-a',
      }),
    ).resolves.toEqual({ deleted: false });

    expect(ctx.editUpload).toHaveBeenCalledWith('upload-a');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
    expect(ctx.scrollToField).not.toHaveBeenCalled();
  });

  it('keeps the already-open record in place', async () => {
    const ctx = {
      item: { id: 'current' },
      scrollToField: vi.fn(),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'current',
    });

    expect(ctx.scrollToField).not.toHaveBeenCalled();
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it('opens a different record in the native edit modal', async () => {
    const ctx = {
      item: { id: 'current' },
      isEnvironmentPrimary: false,
      environment: 'staging copy',
      scrollToField: vi.fn(),
      navigateTo: vi.fn(),
      editItem: vi.fn().mockResolvedValue(undefined),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'target',
      itemTypeId: 'post',
      fieldPath: 'title',
    });

    expect(ctx.editItem).toHaveBeenCalledWith('target');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.scrollToField).not.toHaveBeenCalled();
  });

  it('opens a different record without model metadata in the edit modal', async () => {
    const ctx = {
      item: { id: 'current' },
      scrollToField: vi.fn(),
      navigateTo: vi.fn(),
      editItem: vi.fn().mockResolvedValue(undefined),
    };

    await createSidebarNavigator(ctx as never).openRecord({
      itemId: 'target',
    });

    expect(ctx.editItem).toHaveBeenCalledWith('target');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.scrollToField).not.toHaveBeenCalled();
  });

  it('does nothing when asked to show an empty result set', async () => {
    const ctx = {
      item: { id: 'current' },
      scrollToField: vi.fn(),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).showRecords({
      title: 'No matches',
      records: [],
    });

    expect(ctx.scrollToField).not.toHaveBeenCalled();
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it('opens a single result through the same modal-safe record behavior', async () => {
    const ctx = {
      item: { id: 'current' },
      scrollToField: vi.fn(),
      navigateTo: vi.fn(),
      editItem: vi.fn().mockResolvedValue(undefined),
    };

    await createSidebarNavigator(ctx as never).showRecords({
      title: 'One match',
      records: [
        {
          itemId: 'target',
          itemTypeId: 'post',
          fieldPath: 'title',
        },
      ],
    });

    expect(ctx.editItem).toHaveBeenCalledWith('target');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.scrollToField).not.toHaveBeenCalled();
  });

  it('scrolls instead of opening a modal when the single result is the current record', async () => {
    const ctx = {
      item: { id: 'current' },
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn(),
    };

    await createSidebarNavigator(ctx as never).showRecords({
      title: 'Current record',
      records: [{ itemId: 'current', fieldPath: 'title' }],
    });

    expect(ctx.scrollToField).toHaveBeenCalledWith('title');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'the same model',
      records: [
        { itemId: 'one', itemTypeId: 'post' },
        { itemId: 'two', itemTypeId: 'post' },
      ],
    },
    {
      name: 'mixed models',
      records: [
        { itemId: 'one', itemTypeId: 'post' },
        { itemId: 'two', itemTypeId: 'page' },
      ],
    },
    {
      name: 'missing model metadata',
      records: [{ itemId: 'one' }, { itemId: 'two' }],
    },
  ])(
    'leaves multiple results from $name as clickable chat receipts',
    async ({ records }) => {
      const ctx = {
        item: { id: 'current' },
        scrollToField: vi.fn(),
        navigateTo: vi.fn(),
        editItem: vi.fn(),
      };

      await createSidebarNavigator(ctx as never).showRecords({
        title: 'Matches',
        records,
      });

      expect(ctx.scrollToField).not.toHaveBeenCalled();
      expect(ctx.navigateTo).not.toHaveBeenCalled();
      expect(ctx.editItem).not.toHaveBeenCalled();
    },
  );

  it('never navigates away across all sidebar navigation operations', async () => {
    const ctx = {
      item: { id: 'current' },
      scrollToField: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi.fn(),
      editItem: vi.fn().mockResolvedValue(undefined),
    };
    const navigator = createSidebarNavigator(ctx as never);

    await navigator.openRecord({
      itemId: 'target',
      itemTypeId: 'post',
      fieldPath: 'title',
    });
    await navigator.showRecords({
      title: 'One match',
      records: [{ itemId: 'another', itemTypeId: 'page' }],
    });
    await navigator.showRecords({
      title: 'Several matches',
      records: [
        { itemId: 'one', itemTypeId: 'post' },
        { itemId: 'two', itemTypeId: 'post' },
      ],
    });

    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(ctx.editItem).toHaveBeenNthCalledWith(1, 'target');
    expect(ctx.editItem).toHaveBeenNthCalledWith(2, 'another');
  });
});
