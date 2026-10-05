import { connect, type OnBootCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_EXTENSION_ID, LEGACY_LOCAL_STORAGE_KEY } from '../src/constants';
import { getShopifyClient } from '../src/lib/shopifyClient';
import type { StoreCapabilities } from '../src/types';
import {
  hasNestedQuantifier,
  matchesAutoApplyPattern,
} from '../src/utils/autoApply';
import {
  BOOT_DETECTION_TIMEOUT_MS,
  bootPlugin,
  NOT_CONFIGURED_NOTICE,
  UPGRADED_NOTICE,
} from '../src/utils/boot';
import { removeLegacyCache } from '../src/utils/legacyCache';
import { mount } from '../src/utils/mount';
import { renderEntrypoint } from '../src/utils/render';

vi.mock('datocms-plugin-sdk', () => ({ connect: vi.fn() }));
vi.mock('../src/utils/render', () => ({ renderEntrypoint: vi.fn() }));
vi.mock('../src/utils/mount', () => ({ mount: vi.fn() }));
vi.mock('../src/lib/shopifyClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/shopifyClient')>()),
  getShopifyClient: vi.fn(),
}));
vi.mock('../src/entrypoints/ConfigScreen', () => ({
  default: function ConfigScreen() {
    return null;
  },
}));
vi.mock('../src/entrypoints/FieldConfigScreen', () => ({
  default: function FieldConfigScreen() {
    return null;
  },
}));
vi.mock('../src/entrypoints/FieldExtension', () => ({
  default: function FieldExtension() {
    return null;
  },
}));
vi.mock('../src/entrypoints/PickerModal', () => ({
  default: function PickerModal() {
    return null;
  },
}));

type Hooks = {
  onBoot: (ctx: OnBootCtx) => Promise<void>;
  overrideFieldExtensions: (field: unknown, ctx: unknown) => unknown;
  renderFieldExtension: (id: string, ctx: unknown) => void;
  renderModal: (id: string, ctx: unknown) => void;
};

async function loadHooks(): Promise<Hooks> {
  await import('../src/main');
  const call = vi.mocked(connect).mock.calls[0];
  return call?.[0] as unknown as Hooks;
}

const CAPABILITIES: StoreCapabilities = {
  tags: true,
  inventory: false,
  metafields: true,
  checkedAt: '2026-10-04T08:00:00.000Z',
};

const detectCapabilities = vi.fn();

beforeEach(() => {
  vi.mocked(getShopifyClient).mockClear();
  vi.mocked(mount).mockClear();
  vi.mocked(renderEntrypoint).mockClear();
  detectCapabilities.mockReset();
  detectCapabilities.mockResolvedValue(CAPABILITIES);
  vi.mocked(getShopifyClient).mockReturnValue({
    detectCapabilities,
  } as unknown as ReturnType<typeof getShopifyClient>);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// onBoot
// ---------------------------------------------------------------------------

function bootCtx({
  parameters,
  canEditSchema = true,
  outdatedFields = 0,
}: {
  parameters: unknown;
  canEditSchema?: boolean;
  outdatedFields?: number;
}) {
  const fields = Array.from({ length: outdatedFields }, (_, index) => ({
    id: `field-${index}`,
    attributes: {
      appearance: { editor: 'plugin-1', field_extension: 'legacy' },
    },
  }));
  const ctx = {
    currentRole: {
      meta: { final_permissions: { can_edit_schema: canEditSchema } },
    },
    plugin: { id: 'plugin-1', attributes: { parameters } },
    loadFieldsUsingPlugin: vi.fn(async () => fields),
    updateFieldAppearance: vi.fn(async () => {}),
    updatePluginParameters: vi.fn(async () => {}),
    notice: vi.fn(async () => {}),
  };
  return { ctx, boot: () => bootPlugin(ctx as unknown as OnBootCtx) };
}

const V2 = {
  paramsVersion: '2',
  shopifyDomain: 'acme',
  storefrontAccessToken: 'public-token',
  autoApplyToFieldsWithApiKey: '',
  useDemoStore: false,
};

describe('onBoot', () => {
  it('deletes the 1.x cache for every role', async () => {
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, '{"t-shirt":{}}');
    const { ctx, boot } = bootCtx({ parameters: V2, canEditSchema: false });
    await boot();
    expect(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)).toBeNull();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it('migrates a 1.x store with its detected capabilities', async () => {
    const { ctx, boot } = bootCtx({ parameters: V2, outdatedFields: 2 });
    await boot();

    expect(getShopifyClient).toHaveBeenCalledWith(
      expect.objectContaining({ shopDomain: 'acme.myshopify.com' }),
    );
    expect(ctx.updatePluginParameters).toHaveBeenCalledWith({
      paramsVersion: '3',
      stores: [
        {
          shopDomain: 'acme.myshopify.com',
          storefrontAccessToken: 'public-token',
          tokenless: false,
          capabilities: CAPABILITIES,
        },
      ],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    });
    expect(ctx.updateFieldAppearance).toHaveBeenCalledTimes(2);
    expect(ctx.updateFieldAppearance).toHaveBeenCalledWith('field-0', [
      { operation: 'updateEditor', newFieldExtensionId: FIELD_EXTENSION_ID },
    ]);
    expect(ctx.notice).toHaveBeenCalledWith(UPGRADED_NOTICE);
  });

  it('saves the store as it is when detection fails', async () => {
    detectCapabilities.mockRejectedValue(new Error('offline'));
    const { ctx, boot } = bootCtx({ parameters: V2 });
    await boot();
    const [saved] = ctx.updatePluginParameters.mock.calls[0] as unknown as [
      { stores: Array<Record<string, unknown>> },
    ];
    expect(saved.stores[0]).not.toHaveProperty('capabilities');
    expect(saved.stores[0]?.shopDomain).toBe('acme.myshopify.com');
  });

  it('stops waiting for detection after the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    detectCapabilities.mockImplementation(
      (options: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = options.signal;
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const { ctx, boot } = bootCtx({ parameters: V2 });
    const booting = boot();
    await vi.advanceTimersByTimeAsync(BOOT_DETECTION_TIMEOUT_MS);
    await booting;
    expect(signal?.aborted).toBe(true);
    expect(ctx.updatePluginParameters).toHaveBeenCalledTimes(1);
  });

  it('leaves stores that already know their capabilities alone', async () => {
    const parameters = {
      ...V2,
      paramsVersion: '3',
      stores: [
        {
          shopDomain: 'acme.myshopify.com',
          storefrontAccessToken: 'public-token',
          tokenless: false,
          capabilities: CAPABILITIES,
        },
      ],
      // Not current: v2 keys are still there.
    };
    const { ctx, boot } = bootCtx({ parameters });
    await boot();
    expect(getShopifyClient).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the parameters are already current', async () => {
    const { ctx, boot } = bootCtx({
      parameters: {
        paramsVersion: '3',
        stores: [],
        useDemoStore: true,
        autoApplyToFieldsWithApiKey: '',
      },
    });
    await boot();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('writes v3 on a fresh install without a notice: the settings open next', async () => {
    const { ctx, boot } = bootCtx({ parameters: {} });
    await boot();
    expect(ctx.updatePluginParameters).toHaveBeenCalledWith({
      paramsVersion: '3',
      stores: [],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    });
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('asks for a store when migrated settings end up empty', async () => {
    const { ctx, boot } = bootCtx({
      parameters: { ...V2, shopifyDomain: '', storefrontAccessToken: '' },
    });
    await boot();
    expect(ctx.notice).toHaveBeenCalledWith(NOT_CONFIGURED_NOTICE);
    expect(getShopifyClient).not.toHaveBeenCalled();
  });
});

describe('removeLegacyCache', () => {
  it('deletes only the 1.x localStorage cache', () => {
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, '{"t-shirt":{}}');
    localStorage.setItem('unrelated', 'keep');
    removeLegacyCache();
    expect(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(() => removeLegacyCache()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Auto-apply
// ---------------------------------------------------------------------------

function field(apiKey: string, type = 'json', editor = 'default_editor') {
  return {
    attributes: {
      api_key: apiKey,
      field_type: type,
      appearance: { editor },
    },
  };
}

function hooksCtx(pattern: string) {
  return {
    plugin: {
      id: 'plugin-1',
      attributes: {
        parameters: {
          paramsVersion: '3',
          stores: [],
          useDemoStore: true,
          autoApplyToFieldsWithApiKey: pattern,
        },
      },
    },
  };
}

describe('overrideFieldExtensions', () => {
  it('applies the editor, with the 1.x defaults, to matching fields', async () => {
    const hooks = await loadHooks();
    expect(
      hooks.overrideFieldExtensions(
        field('shopify_product'),
        hooksCtx('^shopify_'),
      ),
    ).toEqual({
      editor: { id: FIELD_EXTENSION_ID, initialHeight: expect.any(Number) },
    });
    expect(
      hooks.overrideFieldExtensions(
        field('shopify_handle', 'string'),
        hooksCtx('^shopify_'),
      ),
    ).toBeDefined();
  });

  it('skips other fields, other types, manual set-ups and broken patterns', async () => {
    const hooks = await loadHooks();
    const ctx = hooksCtx('^shopify_');
    expect(hooks.overrideFieldExtensions(field('title'), ctx)).toBeUndefined();
    expect(
      hooks.overrideFieldExtensions(field('shopify_count', 'integer'), ctx),
    ).toBeUndefined();
    expect(
      hooks.overrideFieldExtensions(
        field('shopify_product', 'json', 'plugin-1'),
        ctx,
      ),
    ).toBeUndefined();
    expect(
      hooks.overrideFieldExtensions(field('shopify_product'), hooksCtx('(')),
    ).toBeUndefined();
    expect(
      hooks.overrideFieldExtensions(field('shopify_product'), hooksCtx('')),
    ).toBeUndefined();
  });
});

describe('matchesAutoApplyPattern', () => {
  it('follows pattern changes', () => {
    expect(matchesAutoApplyPattern('^a', 'abc')).toBe(true);
    expect(matchesAutoApplyPattern('^b', 'abc')).toBe(false);
    expect(matchesAutoApplyPattern('^a', 'abc')).toBe(true);
    expect(matchesAutoApplyPattern('[', 'abc')).toBe(false);
  });
});

describe('hasNestedQuantifier', () => {
  it.each([
    '(\\w+_?)+product$',
    '^(a+)+$',
    '((ab)*c)+',
    '(a{2,})*',
    '(?:x|y+)*z',
    '(a+?)+',
  ])('flags %s', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(true);
  });

  it.each([
    '^shopify_',
    'shopify_.*',
    '^(product|variant)s?$',
    '^(?:shop|store)_\\w+$',
    '([a+])+',
    '(\\+)+',
    '(a{2,3})+',
    '(ab)+',
    '\\(a+\\)+',
  ])('accepts %s', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('render hooks', () => {
  it('load each screen on demand', async () => {
    const hooks = await loadHooks();
    const ctx = { fieldPath: 'shopify_product' };
    hooks.renderFieldExtension('any-id', ctx);
    expect(mount).toHaveBeenCalledWith(expect.any(Promise), ctx);
    const [entrypoint] = vi.mocked(mount).mock.calls[0] ?? [];
    const module = (await entrypoint) as { default: { name: string } };
    expect(module.default.name).toBe('FieldExtension');
  });

  it('only render the picker modal', async () => {
    const hooks = await loadHooks();
    hooks.renderModal('somethingElse', {});
    expect(mount).not.toHaveBeenCalled();
    hooks.renderModal('shopifyPicker', {});
    expect(mount).toHaveBeenCalledTimes(1);
  });
});
