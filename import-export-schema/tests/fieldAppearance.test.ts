import type { SchemaTypes } from '@datocms/cma-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLinkedPluginIds } from '@/utils/datocms/schema';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('editor metadata and appearance portability', () => {
  it('distinguishes an empty installed-plugin list from an unavailable list', () => {
    const field = {
      attributes: {
        appearance: {
          editor: 'missing-editor',
          addons: [{ id: 'missing-addon' }],
        },
      },
    } as unknown as SchemaTypes.Field;
    expect([...findLinkedPluginIds(field, new Set())]).toEqual([]);
    expect([...findLinkedPluginIds(field)]).toEqual(['missing-addon']);
  });
  it('times out stalled metadata requests and keeps the task running with defaults', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetch = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const { defaultAppearanceForFieldType } = await import(
      '@/utils/datocms/fieldTypeInfo'
    );
    const result = defaultAppearanceForFieldType('string');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toMatchObject({ editor: 'single_line' });
    expect(aborted).toBe(true);
    await defaultAppearanceForFieldType('text');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back safely on malformed remote metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ string: {} }) })),
    );
    const { defaultAppearanceForFieldType, isHardcodedEditor } = await import(
      '@/utils/datocms/fieldTypeInfo'
    );
    expect(await defaultAppearanceForFieldType('text')).toMatchObject({
      editor: 'textarea',
    });
    expect(await isHardcodedEditor('single_line')).toBe(true);
    expect(await isHardcodedEditor('plugin')).toBe(false);
  });

  it('preserves editor and addon parameters while mapping plugin IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    const { mapAppearanceToProject } = await import(
      '@/utils/datocms/appearance'
    );
    const field = {
      attributes: {
        field_type: 'string',
        appearance: {
          editor: 'old-editor',
          parameters: { color: 'blue', nested: { enabled: true } },
          field_extension: true,
          addons: [{ id: 'old-addon', parameters: { mode: 'full' } }],
        },
      },
    } as unknown as SchemaTypes.Field;
    const original = JSON.stringify(field);
    expect(
      await mapAppearanceToProject(
        field,
        new Map([
          ['old-editor', 'new-editor'],
          ['old-addon', 'new-addon'],
        ]),
      ),
    ).toMatchObject({
      editor: 'new-editor',
      parameters: field.attributes.appearance.parameters,
      field_extension: true,
      addons: [{ id: 'new-addon', parameters: { mode: 'full' } }],
    });
    expect(JSON.stringify(field)).toBe(original);
  });
});
