// @vitest-environment jsdom

import { useFieldNavigation } from '@hooks/useFieldNavigation';
import type { FieldInfo } from '@hooks/useMentions';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, renderHook } from '../testUtils/react';

const localizedTitle: FieldInfo = {
  apiKey: 'title',
  label: 'Title',
  displayLabel: 'Title',
  fieldPath: 'title',
  depth: 0,
  localized: true,
  availableLocales: ['pt'],
};

const localizedContent: FieldInfo = {
  ...localizedTitle,
  apiKey: 'content',
  label: 'Content',
  displayLabel: 'Content',
  fieldPath: 'content',
  isBlockContainer: true,
  blockFieldType: 'modular_content',
};

function createCtx() {
  return {
    locale: 'en',
    site: { attributes: { locales: ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'ja'] } },
    itemTypes: {
      'block-1': { id: 'block-1', attributes: { name: 'Hero' } },
    },
    formValues: {
      content: {
        pt: [{ itemTypeId: 'block-1', attributes: { heading: 'Olá' } }],
      },
    },
    loadItemTypeFields: vi.fn().mockResolvedValue([
      {
        attributes: {
          api_key: 'heading',
          label: 'Heading',
          localized: false,
          field_type: 'string',
          appearance: {},
        },
      },
    ]),
  } as never;
}

describe('field navigation with a single populated locale', () => {
  it('preserves the sole locale when a scalar field is selected with the mouse', () => {
    const ctx = createCtx();
    const onSelect = vi.fn();
    const { result, unmount } = renderHook(() =>
      useFieldNavigation({ ctx, onSelect, selectedIndex: 0 }),
    );
    act(() => result.current?.handleFieldClick(localizedTitle));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(localizedTitle, 'pt');
    unmount();
  });

  it('loads localized blocks and preserves their locale in the nested field path', async () => {
    const ctx = createCtx();
    const onSelect = vi.fn();
    const { result, unmount } = renderHook(() =>
      useFieldNavigation({ ctx, onSelect, selectedIndex: 0 }),
    );
    act(() => result.current?.handleFieldClick(localizedContent));
    expect(result.current?.viewMode).toBe('blocks');
    expect(result.current?.selectedLocale).toBe('pt');
    expect(result.current?.currentBlocks).toEqual([
      { index: 0, modelId: 'block-1', modelName: 'Hero' },
    ]);
    const block = result.current?.currentBlocks[0];
    if (!block) throw new Error('Missing localized block');
    act(() => result.current?.handleBlockClick(block));
    await flushPromises();
    const field = result.current?.currentNestedFields[0];
    if (!field) throw new Error('Missing nested field');
    act(() => result.current?.handleFieldClick(field));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fieldPath: 'content.pt.0.heading', localized: true }),
      'pt',
    );
    unmount();
  });

  it('opens the same localized block list from a pending keyboard selection', () => {
    const ctx = createCtx();
    let pendingFieldForLocale: FieldInfo | null = localizedContent;
    const onClearPendingField = vi.fn(() => {
      pendingFieldForLocale = null;
    });
    const { result, rerender, unmount } = renderHook(() =>
      useFieldNavigation({
        ctx,
        onSelect: vi.fn(),
        selectedIndex: 0,
        pendingFieldForLocale,
        onClearPendingField,
      }),
    );
    rerender();
    expect(onClearPendingField).toHaveBeenCalledTimes(1);
    expect(result.current?.viewMode).toBe('blocks');
    expect(result.current?.selectedLocale).toBe('pt');
    expect(result.current?.currentBlocks).toHaveLength(1);
    act(() => result.current?.handleBack());
    expect(result.current?.viewMode).toBe('fields');
    unmount();
  });

  it('keeps the locale picker for fields with multiple populated locales', () => {
    const ctx = createCtx();
    const onSelect = vi.fn();
    const { result, unmount } = renderHook(() =>
      useFieldNavigation({ ctx, onSelect, selectedIndex: 0 }),
    );
    act(() => result.current?.handleFieldClick({
      ...localizedContent,
      availableLocales: ['en', 'pt'],
    }));
    expect(result.current?.viewMode).toBe('locales');
    expect(result.current?.selectedLocale).toBeUndefined();
    act(() => result.current?.handleLocaleClick('pt'));
    expect(result.current?.viewMode).toBe('blocks');
    expect(result.current?.selectedLocale).toBe('pt');
    expect(result.current?.currentBlocks).toHaveLength(1);
    unmount();
  });
});
