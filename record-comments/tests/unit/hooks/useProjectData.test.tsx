// @vitest-environment jsdom

import { useProjectData } from '@hooks/useProjectData';
import { act } from 'react';
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

function createRecordCtx(recordId: string, formValues: Record<string, unknown>) {
  const topLevelFields = [
    {
      attributes: {
        api_key: 'title',
        label: 'Title',
        localized: true,
        field_type: 'string',
        appearance: {},
        validators: {},
      },
    },
    {
      attributes: {
        api_key: 'content',
        label: 'Content',
        localized: false,
        field_type: 'modular_content',
        appearance: {},
        validators: { item_item_type: { item_types: ['hero', 'text'] } },
      },
    },
  ];
  return {
    environment: 'main',
    item: { id: recordId },
    itemType: { id: 'model-1' },
    itemTypes: {
      hero: {
        id: 'hero',
        attributes: { name: 'Hero', api_key: 'hero', modular_block: true },
      },
      text: {
        id: 'text',
        attributes: { name: 'Text', api_key: 'text', modular_block: true },
      },
    },
    formValues,
    site: {
      id: 'site-1',
      attributes: { locales: ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'ja'] },
    },
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
    loadItemTypeFields: vi.fn(async (modelId: string) => {
      if (modelId === 'model-1') return topLevelFields;
      return [
        {
          attributes: {
            api_key: modelId === 'hero' ? 'heading' : 'description',
            label: modelId === 'hero' ? 'Heading' : 'Description',
            localized: false,
            field_type: 'string',
            appearance: {},
            validators: {},
          },
        },
      ];
    }),
  };
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

  it('refreshes locale and nested field metadata when moving between records of the same model', async () => {
    let ctx = createRecordCtx('record-a', {
      title: { en: 'Record A' },
      content: [{ itemTypeId: 'hero', attributes: { heading: 'Hero A' } }],
    });
    const { result, rerender, unmount } = renderHook(() =>
      useProjectData(ctx as never, { loadFields: true }),
    );
    await flushPromises();
    expect(
      result.current?.modelFields.find((field) => field.apiKey === 'title')
        ?.availableLocales,
    ).toEqual(['en']);
    expect(result.current?.modelFields.map((field) => field.fieldPath)).toEqual([
      'title', 'content', 'content.0.heading',
    ]);

    ctx = createRecordCtx('record-b', {
      title: { pt: 'Record B' },
      content: [{ itemTypeId: 'text', attributes: { description: 'Text B' } }],
    });
    rerender();
    await flushPromises();
    expect(
      result.current?.modelFields.find((field) => field.apiKey === 'title')
        ?.availableLocales,
    ).toEqual(['pt']);
    expect(result.current?.modelFields.map((field) => field.fieldPath)).toEqual([
      'title', 'content', 'content.0.description',
    ]);
    unmount();
  });

  it('updates locales and block paths within a record without reloading schema for ordinary typing', async () => {
    let ctx = createRecordCtx('record-a', {
      title: { en: 'Record A' },
      content: [{ itemTypeId: 'hero', attributes: { heading: 'Hero A' } }],
    });
    const loadItemTypeFields = ctx.loadItemTypeFields;
    const { result, rerender, unmount } = renderHook(() =>
      useProjectData(ctx as never, { loadFields: true }),
    );
    await flushPromises();
    expect(loadItemTypeFields).toHaveBeenCalledTimes(2);

    ctx = {
      ...ctx,
      formValues: {
        title: { en: '', pt: 'Olá' },
        content: [
          { itemTypeId: 'hero', attributes: { heading: 'Hero A' } },
          { itemTypeId: 'text', attributes: { description: 'Text A' } },
        ],
      },
    };
    rerender();
    await flushPromises();
    expect(
      result.current?.modelFields.find((field) => field.apiKey === 'title')
        ?.availableLocales,
    ).toEqual(['pt']);
    expect(result.current?.modelFields.map((field) => field.fieldPath)).toEqual([
      'title', 'content', 'content.0.heading', 'content.1.description',
    ]);
    expect(loadItemTypeFields).toHaveBeenCalledTimes(3);

    const fieldsBeforeTyping = result.current?.modelFields;
    ctx = {
      ...ctx,
      formValues: { ...ctx.formValues, title: { en: '', pt: 'Olá mundo' } },
    };
    rerender();
    await flushPromises();
    expect(loadItemTypeFields).toHaveBeenCalledTimes(3);
    expect(result.current?.modelFields).toBe(fieldsBeforeTyping);
    expect(result.current?.isLoadingFields).toBe(false);
    unmount();
  });

  it('recomputes metadata at a record boundary even when values have the same shape', async () => {
    let ctx = createRecordCtx('record-a', { title: { en: 'Record A' } });
    const loadItemTypeFields = ctx.loadItemTypeFields;
    const { result, rerender, unmount } = renderHook(() =>
      useProjectData(ctx as never, { loadFields: true }),
    );
    await flushPromises();
    const previousFields = result.current?.modelFields;
    ctx = { ...ctx, item: { id: 'record-b' }, formValues: { title: { en: 'Record B' } } };
    rerender();
    await flushPromises();
    expect(result.current?.modelFields).not.toBe(previousFields);
    expect(loadItemTypeFields).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('reloads schema explicitly on retry after a failed load', async () => {
    const ctx = createRecordCtx('record-a', { title: { en: 'Record A' } });
    ctx.loadItemTypeFields.mockRejectedValueOnce(new Error('Field load failed'));
    const { result, unmount } = renderHook(() =>
      useProjectData(ctx as never, { loadFields: true }),
    );
    await flushPromises();
    expect(result.current?.fieldLoadError).not.toBeNull();
    act(() => result.current?.retryFields());
    await flushPromises();
    expect(result.current?.fieldLoadError).toBeNull();
    expect(result.current?.modelFields.map((field) => field.fieldPath)).toEqual([
      'title', 'content',
    ]);
    expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(2);
    unmount();
  });
});
