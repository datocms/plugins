import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changesSinceSaved } from '../src/components/fieldConfig/changes';
import {
  parametersFromDraft,
  parseLimit,
  withFormat,
  withStore,
} from '../src/components/fieldConfig/draft';
import { savedParametersOf } from '../src/components/fieldConfig/useSavedParameters';
import { FIELD_EXTENSION_ID } from '../src/constants';
import FieldConfigScreen from '../src/entrypoints/FieldConfigScreen';
import {
  normalizePluginParameters,
  validateFieldParameters,
} from '../src/lib/parameters';
import { buildExampleStoredValue } from '../src/lib/references';
import { ShopifyClientError } from '../src/lib/shopifyClient';
import {
  type CollectionSummary,
  DEMO_STORE,
  type FieldParametersV1,
  type StoreCapabilities,
  type StoreConnection,
} from '../src/types';

const clients = vi.hoisted(() => {
  const make = (shopDomain: string) => ({
    shopDomain,
    collections: vi.fn(),
    filterValues: vi.fn(),
    effectiveCapabilities: vi.fn(),
    hasKnownCapabilities: vi.fn(),
    detectCapabilities: vi.fn(),
    browseCollectionProducts: vi.fn(),
  });
  return {
    'datocms-demo.myshopify.com': make('datocms-demo.myshopify.com'),
    'acme-us.myshopify.com': make('acme-us.myshopify.com'),
  };
});

vi.mock('../src/lib/shopifyClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/shopifyClient')>()),
  getShopifyClient: vi.fn(
    (store: { shopDomain: string }) =>
      clients[store.shopDomain as keyof typeof clients],
  ),
}));

// The kit's copy button copies through this library: jsdom can't copy.
vi.mock('copy-to-clipboard', () => ({ default: vi.fn(() => true) }));

const { getShopifyClient } = await import('../src/lib/shopifyClient');
const { default: copyToClipboard } = await import('copy-to-clipboard');

/** The EU store's client, which most tests talk to. */
const client = clients['datocms-demo.myshopify.com'];
const usClient = clients['acme-us.myshopify.com'];

type Ctx = RenderManualFieldExtensionConfigScreenCtx;

const CAPABILITIES = {
  tags: true,
  inventory: false,
  metafields: false,
  checkedAt: '2026-10-03T12:00:00Z',
};

const EU_STORE: StoreConnection = {
  ...DEMO_STORE,
  label: 'EU store',
  capabilities: CAPABILITIES,
};

const US_STORE: StoreConnection = {
  shopDomain: 'acme-us.myshopify.com',
  storefrontAccessToken: 'public-token',
  tokenless: false,
  label: 'US store',
  capabilities: CAPABILITIES,
};

const PLUGIN_ID = 'shopify-plugin-id';
const MODEL_ID = 'model-1';

function pluginParameters(stores: StoreConnection[], useDemoStore = false) {
  return {
    paramsVersion: '3',
    stores,
    useDemoStore,
    autoApplyToFieldsWithApiKey: '',
  };
}

const REFERENCE: FieldParametersV1 = {
  paramsVersion: '1',
  kind: 'product',
  cardinality: 'single',
  format: 'reference',
  snapshot: false,
};

function collection(id: string, title: string): CollectionSummary {
  return {
    __typename: 'Collection',
    id: `gid://shopify/Collection/${id}`,
    handle: title.toLowerCase(),
    title,
    updatedAt: '2026-07-19T00:46:43Z',
    onlineStoreUrl: null,
    image: null,
  };
}

type Setup = {
  parameters?: Record<string, unknown>;
  fieldType?: string;
  errors?: Record<string, unknown>;
  /** Omit for a field that's being created. */
  fieldId?: string | null;
  stores?: StoreConnection[];
  /** The plugin settings have the demo store switched on. */
  useDemoStore?: boolean;
  strict?: boolean;
  /**
   * What the saved field entity holds: this extension's parameters (default:
   * `parameters`, as when the modal opens), or another editor.
   */
  saved?: Record<string, unknown> | 'other-editor';
  /** The saved entity only comes from `loadItemTypeFields`, not `ctx.fields`. */
  savedViaLoad?: boolean;
};

function fieldEntity(
  id: string,
  fieldType: string,
  saved: Record<string, unknown> | 'other-editor',
) {
  return {
    id,
    type: 'field',
    attributes: {
      field_type: fieldType,
      appearance:
        saved === 'other-editor'
          ? { editor: 'json', parameters: {}, addons: [] }
          : {
              editor: PLUGIN_ID,
              field_extension: FIELD_EXTENSION_ID,
              parameters: saved,
              addons: [],
            },
    },
  };
}

function setup({
  parameters = {},
  fieldType = 'json',
  errors = {},
  fieldId = '42',
  stores = [EU_STORE],
  useDemoStore = false,
  strict = false,
  saved = parameters,
  savedViaLoad = false,
}: Setup = {}) {
  const setParameters = vi.fn<
    (params: Record<string, unknown>) => Promise<void>
  >(() => Promise.resolve());
  const entity = fieldId ? fieldEntity(fieldId, fieldType, saved) : null;
  const loadItemTypeFields = vi.fn(async () => (entity ? [entity] : []));
  const fields = entity && !savedViaLoad ? { [entity.id]: entity } : {};
  const buildCtx = (
    nextParameters: Record<string, unknown>,
    nextErrors: Record<string, unknown> = errors,
  ) =>
    ({
      mode: 'renderManualFieldExtensionConfigScreen',
      fieldExtensionId: FIELD_EXTENSION_ID,
      bodyPadding: [10, 10, 10, 10],
      cssDesignTokens: {},
      colorScheme: 'light',
      theme: {},
      ui: { locale: 'en' },
      site: { attributes: { internal_domain: null } },
      startAutoResizer: vi.fn(),
      stopAutoResizer: vi.fn(),
      notice: vi.fn(async () => undefined),
      alert: vi.fn(async () => undefined),
      customToast: vi.fn(async () => undefined),
      openConfirm: vi.fn(async () => true),
      navigateTo: vi.fn(),
      parameters: nextParameters,
      errors: nextErrors,
      pendingField: {
        ...(fieldId ? { id: fieldId } : {}),
        type: 'field',
        attributes: { field_type: fieldType },
      },
      itemType: { id: MODEL_ID, type: 'item_type' },
      fields,
      loadItemTypeFields,
      plugin: {
        id: PLUGIN_ID,
        attributes: { parameters: pluginParameters(stores, useDemoStore) },
      },
      setParameters,
    }) as unknown as Ctx;

  const wrap = (ctx: Ctx) =>
    strict ? (
      <StrictMode>
        <FieldConfigScreen ctx={ctx} />
      </StrictMode>
    ) : (
      <FieldConfigScreen ctx={ctx} />
    );

  const view = render(wrap(buildCtx(parameters)));
  return {
    setParameters,
    loadItemTypeFields,
    user: userEvent.setup(),
    /** The host re-renders with new parameters (or the echo of a write). */
    rerenderWith: (
      nextParameters: Record<string, unknown>,
      nextErrors?: Record<string, unknown>,
    ) => view.rerender(wrap(buildCtx(nextParameters, nextErrors))),
    lastWrite: () => setParameters.mock.lastCall?.[0],
  };
}

/**
 * What the example shows: the readable view of a JSON value in its code box,
 * or a string value in its read-only field.
 */
function example(): string {
  const box = screen.queryByRole('region', { name: 'Stored value example' });
  if (box) return box.textContent as string;
  return (
    screen.getByRole('textbox', {
      name: 'Stored value example',
    }) as HTMLInputElement
  ).value;
}

/** A radio by the start of its name (its label, then its hint). */
function radio(label: string): HTMLElement {
  return screen.getByRole('radio', { name: new RegExp(`^${label}\\b`) });
}

function group(name: string): HTMLElement {
  return screen.getByRole('radiogroup', { name });
}

/** A store of the store choice (radios for a few stores). */
function storeRadio(name: RegExp): HTMLElement {
  return within(group('Store')).getByRole('radio', { name });
}

function limitsToggle(): HTMLElement {
  return screen.getByRole('button', { name: /^Limit choices/ });
}

/** A danger or warning callout (role alert) holding the text. */
function alertWith(text: string | RegExp): HTMLElement {
  const match = screen
    .getAllByRole('alert')
    .find((element) =>
      typeof text === 'string'
        ? element.textContent?.includes(text)
        : text.test(element.textContent ?? ''),
    );
  if (!match) throw new Error(`No alert with ${String(text)}`);
  return match;
}

/** A Search & Discovery filter as `collection.products.filters` lists it. */
function shopifyFilter(id: string, input: string) {
  return {
    id,
    label: id,
    type: 'LIST',
    values: [{ id: `${id}.1`, label: 'Value', count: 1, input }],
  };
}

const AVAILABILITY_FILTER = shopifyFilter(
  'filter.v.availability',
  '{"available":true}',
);
const TAG_FILTER = shopifyFilter('filter.p.tag', '{"tag":"Premium"}');

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(clients)) {
    mock.collections.mockResolvedValue({
      nodes: [collection('1', 'Hydrogen'), collection('2', 'Home page')],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    mock.filterValues.mockResolvedValue({
      productTypes: ['snowboard', 'accessories'],
      tags: ['Premium', 'Winter'],
    });
    mock.effectiveCapabilities.mockReturnValue({
      tags: true,
      inventory: false,
      metafields: false,
    });
    // Saved in the settings, or tokenless: nothing to detect.
    mock.hasKnownCapabilities.mockReturnValue(true);
    mock.browseCollectionProducts.mockResolvedValue({
      found: true,
      page: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      filters: [AVAILABILITY_FILTER, TAG_FILTER],
    });
  }
});

afterEach(cleanup);

describe('FieldConfigScreen: new and 1.x fields', () => {
  it('writes the reference-document defaults once for a new JSON field', async () => {
    const { setParameters, rerenderWith } = setup({
      fieldId: null,
      strict: true,
    });

    expect(setParameters).toHaveBeenCalledTimes(1);
    expect(setParameters).toHaveBeenCalledWith(REFERENCE);
    expect(radio('Reference document')).toBeChecked();
    expect(screen.queryByText(/uses the 1.x settings/)).not.toBeInTheDocument();

    rerenderWith({ ...REFERENCE });
    expect(setParameters).toHaveBeenCalledTimes(1);
  });

  it('writes the handle defaults for a new string field', () => {
    const { setParameters } = setup({ fieldId: null, fieldType: 'string' });
    expect(setParameters).toHaveBeenCalledWith({
      ...REFERENCE,
      format: 'handle',
    });
  });

  it('shows a 1.x JSON field with its legacy defaults and writes nothing', () => {
    const { setParameters } = setup();

    expect(setParameters).not.toHaveBeenCalled();
    expect(
      screen.getByText(/uses the 1.x settings \(product JSON\)/),
    ).toBeVisible();
    expect(radio('Legacy product JSON')).toBeChecked();
    expect(radio('Products')).toBeChecked();
    expect(radio('Product variants')).toBeDisabled();
    expect(radio('Collections')).toBeDisabled();
    expect(screen.queryByRole('radiogroup', { name: 'How many' })).toBeNull();
    expect(screen.queryByLabelText(/display snapshot/)).toBeNull();
    expect(JSON.parse(example())).toMatchObject({
      handle: 'the-complete-snowboard',
      imageUrl: expect.any(String),
      previewImageUrl: expect.any(String),
    });
  });

  it('opts a 1.x JSON field in and warns about the format change', async () => {
    const { setParameters, user, rerenderWith, lastWrite } = setup();

    await user.click(radio('Reference document'));

    expect(setParameters).toHaveBeenCalledTimes(1);
    expect(lastWrite()).toEqual(REFERENCE);
    expect(screen.queryByText(/uses the 1.x settings/)).toBeNull();
    // The warning sits under the format it is about.
    expect(
      alertWith(/Existing records keep their current value/),
    ).toBeVisible();

    rerenderWith(lastWrite() ?? {});
    expect(radio('Reference document')).toBeChecked();
    expect(group('How many')).toBeVisible();
  });

  it('shows a 1.x string field as product handles and writes nothing', () => {
    const { setParameters } = setup({ fieldType: 'string' });

    expect(setParameters).not.toHaveBeenCalled();
    expect(
      screen.getByText(/uses the 1.x settings \(product handle\)/),
    ).toBeVisible();
    expect(radio('Handle')).toBeChecked();
    // A kind the format can't store says why, in place of its hint.
    expect(radio('Product variants')).toBeDisabled();
    expect(
      screen.getByText(
        'Needs the Shopify ID format, since variants have no handle.',
      ),
    ).toBeVisible();
    expect(radio('Collections')).toBeEnabled();
    expect(example()).toBe('the-complete-snowboard');
  });

  it('leaves settings from an unknown version untouched until a change', async () => {
    const { setParameters, user } = setup({
      parameters: { paramsVersion: '9', kind: 'variant' },
      errors: { paramsVersion: 'Unsupported settings version' },
    });

    expect(
      screen.getByText(/come from an unknown plugin version/),
    ).toBeVisible();
    expect(screen.queryByText('Unsupported settings version')).toBeNull();
    expect(setParameters).not.toHaveBeenCalled();

    await user.click(radio('Reference document'));
    expect(setParameters).toHaveBeenCalledWith(REFERENCE);
  });

  it('explains that other field types are not supported', () => {
    const { setParameters } = setup({ fieldType: 'text' });
    expect(
      screen.getByText(/works on Single-line string and JSON fields/),
    ).toBeVisible();
    expect(setParameters).not.toHaveBeenCalled();
  });
});

describe('FieldConfigScreen: kinds and formats', () => {
  it('stores variants as Shopify IDs in a string field', async () => {
    const { user, lastWrite, rerenderWith } = setup({ fieldType: 'string' });

    await user.click(radio('Shopify ID'));
    expect(lastWrite()).toEqual({ ...REFERENCE, format: 'gid' });
    rerenderWith(lastWrite() ?? {});

    const variants = radio('Product variants');
    expect(variants).toBeEnabled();
    await user.click(variants);
    expect(lastWrite()).toEqual({
      ...REFERENCE,
      format: 'gid',
      kind: 'variant',
    });
    expect(example()).toBe('gid://shopify/ProductVariant/50698337681754');
  });

  it('resets the kind when the new format cannot store it', async () => {
    const { user, lastWrite } = setup({
      fieldType: 'string',
      parameters: { ...REFERENCE, format: 'gid', kind: 'variant' },
    });

    await user.click(radio('Handle'));
    expect(lastWrite()).toEqual({ ...REFERENCE, format: 'handle' });
    expect(radio('Products')).toBeChecked();
  });

  it('drops multiple, limits and the snapshot when switching to legacy JSON', async () => {
    const { user, lastWrite } = setup({
      parameters: {
        ...REFERENCE,
        kind: 'collection',
        cardinality: 'multiple',
        snapshot: true,
        max: 3,
      },
    });

    await user.click(radio('Legacy product JSON'));
    expect(lastWrite()).toEqual({ ...REFERENCE, format: 'legacyProductJson' });
  });

  it('warns when a saved field changes kind', async () => {
    const { user } = setup({ parameters: { ...REFERENCE } });

    expect(screen.queryByText(/Existing records keep/)).toBeNull();
    await user.click(radio('Collections'));
    expect(screen.getByText(/Existing records keep/)).toBeVisible();
    // The radio keeps the focus while the warning comes and goes.
    await user.click(radio('Products'));
    expect(screen.queryByText(/Existing records keep/)).toBeNull();
    expect(radio('Products')).toHaveFocus();
  });

  it('never warns about format changes on a new field', async () => {
    const { user } = setup({ fieldId: null });
    await user.click(radio('Legacy product JSON'));
    expect(screen.queryByText(/Existing records keep/)).toBeNull();
  });

  it('keeps warning about a pending format change when the screen mounts again', () => {
    // A 1.x field opted in, then the tab was left and opened again before
    // saving: the host hands back the pending settings, the saved field has none.
    setup({ parameters: { ...REFERENCE }, saved: {} });
    expect(screen.getByText(/Existing records keep/)).toBeVisible();
    expect(screen.queryByText(/uses the 1.x settings/)).toBeNull();
  });

  it('loads the saved settings when the field is not loaded yet', async () => {
    const { loadItemTypeFields } = setup({
      parameters: { ...REFERENCE },
      saved: {},
      savedViaLoad: true,
    });
    expect(await screen.findByText(/Existing records keep/)).toBeVisible();
    expect(loadItemTypeFields).toHaveBeenCalledWith(MODEL_ID);
  });

  it('compares with no settings when the field was saved with another editor', () => {
    setup({ parameters: { ...REFERENCE }, saved: 'other-editor' });
    expect(screen.getByText(/Existing records keep/)).toBeVisible();
  });

  it('names the recommended format', () => {
    setup({ parameters: { ...REFERENCE } });
    expect(radio('Reference document')).toHaveAccessibleName(
      /^Reference document Recommended/,
    );
    expect(radio('Legacy product JSON')).not.toHaveAccessibleName(
      /Recommended/,
    );
  });

  it('shows the snapshot in the example once it is switched on', async () => {
    const { user, lastWrite } = setup({ parameters: { ...REFERENCE } });

    expect(JSON.parse(example()).references[0].snapshot).toBeUndefined();
    await user.click(screen.getByLabelText('Include a display snapshot'));

    expect(lastWrite()).toEqual({ ...REFERENCE, snapshot: true });
    expect(JSON.parse(example()).references[0].snapshot).toMatchObject({
      title: 'The Complete Snowboard',
      price: { amount: '699.95', currencyCode: 'EUR' },
    });
  });
});

describe('FieldConfigScreen: how many', () => {
  it('reveals min and max for multiple and writes them as numbers', async () => {
    const { user, lastWrite, setParameters } = setup({
      parameters: { ...REFERENCE },
    });

    expect(screen.queryByLabelText('Minimum items')).toBeNull();
    await user.click(radio('Multiple'));
    expect(lastWrite()).toEqual({ ...REFERENCE, cardinality: 'multiple' });
    expect(radio('Multiple')).toBeChecked();

    await user.type(screen.getByLabelText('Minimum items'), '1');
    await user.type(screen.getByLabelText('Maximum items'), '12');
    expect(lastWrite()).toEqual({
      ...REFERENCE,
      cardinality: 'multiple',
      min: 1,
      max: 12,
    });
    expect(screen.getByLabelText('Maximum items')).toHaveValue('12');
    expect(JSON.parse(example()).references).toHaveLength(2);

    setParameters.mockClear();
    await user.click(radio('One'));
    expect(lastWrite()).toEqual({ ...REFERENCE });
  });

  it('keeps what was typed while the host echoes earlier writes', async () => {
    const { user, setParameters, rerenderWith } = setup({
      parameters: { ...REFERENCE, cardinality: 'multiple' },
    });

    await user.type(screen.getByLabelText('Maximum items'), '25');
    const [first] = setParameters.mock.calls[0] ?? [];
    rerenderWith(first ?? {});
    expect(screen.getByLabelText('Maximum items')).toHaveValue('25');
  });

  it('writes invalid limits as typed so the validator can flag them', async () => {
    const { user, lastWrite } = setup({
      parameters: { ...REFERENCE, cardinality: 'multiple' },
    });

    await user.type(screen.getByLabelText('Minimum items'), 'two');
    expect(lastWrite()).toMatchObject({ min: 'two' });
  });

  it('shows ctx.errors under the matching controls', () => {
    setup({
      parameters: { ...REFERENCE, cardinality: 'multiple', min: 5, max: 2 },
      errors: {
        min: "Minimum can't be greater than maximum",
        kind: 'Choose products, variants or collections',
      },
    });

    expect(screen.getByLabelText('Minimum items')).toHaveValue('5');
    expect(screen.getByLabelText('Maximum items')).toHaveValue('2');
    expect(
      screen.getByText("Minimum can't be greater than maximum"),
    ).toBeVisible();
    expect(
      screen.getByText('Choose products, variants or collections'),
    ).toBeVisible();
    expect(group('Editors pick')).toHaveAccessibleDescription(
      'Choose products, variants or collections',
    );
    expect(screen.queryByText(/These settings aren't valid/)).toBeNull();
  });

  it('lists errors whose control is hidden above the settings', () => {
    setup({
      parameters: { ...REFERENCE },
      errors: {
        shopDomain: 'Enter a valid shop domain, like acme.myshopify.com',
      },
    });
    const alert = alertWith('Enter a valid shop domain');
    expect(alert).toHaveTextContent("These settings aren't valid");
    expect(
      screen.queryByRole('button', { name: 'Use these settings' }),
    ).toBeNull();
  });

  it('warns when a saved field goes back from multiple to one', async () => {
    const { user } = setup({
      parameters: { ...REFERENCE, cardinality: 'multiple' },
    });

    expect(screen.queryByText(/already hold several items/)).toBeNull();
    await user.click(radio('One'));
    expect(
      alertWith(
        'Records that already hold several items show an error until an editor picks a single one again.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Existing records keep/)).toBeNull();
  });
});

describe('FieldConfigScreen: limit choices', () => {
  it('warns when Shopify ignores tag limits inside the collection', async () => {
    client.browseCollectionProducts.mockResolvedValue({
      found: true,
      page: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      filters: [AVAILABILITY_FILTER],
    });
    setup({
      parameters: {
        ...REFERENCE,
        scope: {
          collectionId: 'gid://shopify/Collection/1',
          collectionTitle: 'Hydrogen',
          tags: ['Premium', 'Winter'],
        },
      },
    });

    expect(
      await screen.findByText(
        "Shopify can't apply tag limits inside this collection until the Tag filter is enabled in the Search & Discovery app.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Editors only see products tagged/)).toBeNull();
  });

  it('flags a limited collection Shopify cannot find', async () => {
    client.browseCollectionProducts.mockResolvedValue({
      found: false,
      page: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      filters: [],
    });
    setup({
      parameters: {
        ...REFERENCE,
        scope: {
          collectionId: 'gid://shopify/Collection/9',
          collectionTitle: 'Gone',
        },
      },
    });
    expect(
      await screen.findByText(
        'Not visible to the storefront: it may be unpublished from the Headless channel, or deleted.',
      ),
    ).toBeVisible();
  });

  it('stays closed and loads nothing until opened', async () => {
    const { user } = setup({ parameters: { ...REFERENCE } });
    const toggle = limitsToggle();

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('No limits');
    expect(screen.queryByLabelText('Vendor')).toBeNull();
    expect(client.collections).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Editors only see matching products, with these limits shown as locked filters in the picker.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(client.collections).toHaveBeenCalled());
    expect(getShopifyClient).toHaveBeenCalledWith(EU_STORE);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Vendor')).toBeNull();
  });

  it('limits products to a collection picked from the store', async () => {
    const { user, lastWrite } = setup({ parameters: { ...REFERENCE } });
    await user.click(limitsToggle());

    await user.click(screen.getByLabelText('Collection'));
    // The menu shows each collection's handle under its title.
    const option = await screen.findByRole('option', { name: /Hydrogen/ });
    expect(option).toHaveTextContent('hydrogen');
    await user.click(option);

    expect(lastWrite()).toEqual({
      ...REFERENCE,
      scope: {
        collectionId: 'gid://shopify/Collection/1',
        collectionTitle: 'Hydrogen',
      },
    });
    expect(limitsToggle()).toHaveTextContent('Hydrogen');
  });

  it('shows the saved collection before the list has it', () => {
    client.collections.mockReturnValue(new Promise(() => {}));
    setup({
      parameters: {
        ...REFERENCE,
        scope: {
          collectionId: 'gid://shopify/Collection/7',
          collectionTitle: 'Summer',
        },
      },
    });
    const field = screen
      .getByLabelText('Collection')
      .closest('.form__field') as HTMLElement;
    expect(within(field).getByText('Summer')).toBeVisible();
  });

  it('searches collections by title prefix', async () => {
    const { user } = setup({ parameters: { ...REFERENCE } });
    await user.click(limitsToggle());
    await user.type(screen.getByLabelText('Collection'), 'Hyd');

    await waitFor(
      () =>
        expect(client.collections).toHaveBeenLastCalledWith(
          { first: 50, query: 'title:Hyd*' },
          expect.anything(),
        ),
      { timeout: 2000 },
    );
  });

  it('opens with the saved limits and edits them', async () => {
    const { user, lastWrite } = setup({
      parameters: {
        ...REFERENCE,
        scope: {
          collectionId: 'gid://shopify/Collection/1',
          collectionTitle: 'Hydrogen',
          tags: ['Premium', 'Winter'],
        },
      },
    });

    expect(limitsToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(limitsToggle()).toHaveTextContent('Hydrogen · Premium or Winter');
    // The collection has the Tag filter enabled, so the tag limit applies.
    expect(
      await screen.findByText(
        'Editors only see products tagged Premium or Winter.',
      ),
    ).toBeVisible();
    expect(client.browseCollectionProducts).toHaveBeenCalledWith(
      { collectionId: 'gid://shopify/Collection/1', first: 1 },
      expect.anything(),
    );
    expect(screen.queryByText(/can't apply tag limits/)).toBeNull();

    await user.type(screen.getByLabelText('Vendor'), 'Snowboard Vendor ');
    expect(lastWrite()).toMatchObject({
      scope: { vendor: 'Snowboard Vendor' },
    });
    expect(screen.getByLabelText('Vendor')).toHaveValue('Snowboard Vendor ');

    await user.click(
      screen.getByLabelText('Only show products available for sale'),
    );
    expect(lastWrite()).toMatchObject({ scope: { availableOnly: true } });

    await user.click(screen.getByLabelText('Product type'));
    await user.click(await screen.findByText('accessories'));
    expect(lastWrite()).toMatchObject({
      scope: {
        collectionId: 'gid://shopify/Collection/1',
        productType: 'accessories',
        tags: ['Premium', 'Winter'],
      },
    });

    // Switching it off removes the limit instead of saving false.
    await user.click(
      screen.getByLabelText('Only show products available for sale'),
    );
    expect(lastWrite()?.scope).not.toHaveProperty('availableOnly');
  });

  it('uses a product type or a tag the store does not list', async () => {
    const { user, lastWrite } = setup({ parameters: { ...REFERENCE } });
    await user.click(limitsToggle());
    await waitFor(() => expect(client.filterValues).toHaveBeenCalled());

    await user.type(screen.getByLabelText('Product type'), 'boots');
    await user.click(await screen.findByText('Use “boots”'));
    expect(lastWrite()).toMatchObject({ scope: { productType: 'boots' } });

    await user.type(screen.getByLabelText('Tags'), 'Sale');
    await user.click(await screen.findByText('Use “Sale”'));
    expect(lastWrite()).toMatchObject({
      scope: { productType: 'boots', tags: ['Sale'] },
    });
  });

  it('explains how to enable tags when the token cannot read them', async () => {
    client.effectiveCapabilities.mockReturnValue({
      tags: false,
      inventory: false,
      metafields: false,
    });
    const { user } = setup({ parameters: { ...REFERENCE } });
    await user.click(limitsToggle());

    expect(screen.getByText(/enable "Read product tags"/)).toBeVisible();
    expect(screen.getByLabelText('Tags')).toBeDisabled();
    expect(screen.getByLabelText('Tags')).toHaveAccessibleDescription(
      /^To limit choices by tag, enable "Read product tags"/,
    );
  });

  it('keeps saved tags removable when the token cannot read them', async () => {
    client.effectiveCapabilities.mockReturnValue({
      tags: false,
      inventory: false,
      metafields: false,
    });
    setup({ parameters: { ...REFERENCE, scope: { tags: ['Premium'] } } });

    expect(screen.getByLabelText('Tags')).toBeEnabled();
    expect(screen.queryByText(/enable "Read product tags"/)).toBeNull();
  });

  it('shows a retryable error when the store cannot be reached', async () => {
    client.filterValues.mockRejectedValueOnce(
      new ShopifyClientError('network', 'boom', {
        userMessage:
          "Couldn't reach Shopify. Check your connection or ad-blocker.",
      }),
    );
    const { user } = setup({ parameters: { ...REFERENCE } });
    await user.click(limitsToggle());

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText("Couldn't load the lists from Shopify"),
    ).toBeVisible();
    expect(alert).toHaveTextContent(/Couldn't reach Shopify/);
    // The retry sits under the callout, never inside it.
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(client.collections).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.filterValues).toHaveBeenCalledTimes(2));
    // Only the lookup that failed runs again.
    expect(client.collections).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't reach Shopify/)).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows a hint instead of the store lists when the plugin is not configured', async () => {
    const { user } = setup({ parameters: { ...REFERENCE }, stores: [] });
    await user.click(limitsToggle());

    expect(
      screen.getByText(/Connect a Shopify store in the plugin settings/),
    ).toBeVisible();
    expect(screen.queryByLabelText('Collection')).toBeNull();
    expect(screen.getByLabelText('Vendor')).toBeVisible();
    expect(getShopifyClient).not.toHaveBeenCalled();
  });

  it('is hidden for collections and drops their limits', async () => {
    const { user, lastWrite } = setup({
      parameters: { ...REFERENCE, scope: { vendor: 'Acme' } },
    });
    await user.click(screen.getByLabelText(/Collections/));

    expect(lastWrite()).toEqual({ ...REFERENCE, kind: 'collection' });
    expect(screen.queryByRole('button', { name: /^Limit choices/ })).toBeNull();
    expect(screen.queryByText('Limit choices')).toBeNull();
  });
});

describe('FieldConfigScreen: tag access', () => {
  const { capabilities: _saved, ...UNCHECKED_STORE } = EU_STORE;

  const NETWORK_ERROR = new ShopifyClientError('network', 'boom', {
    userMessage: "Couldn't reach Shopify. Check your connection or ad-blocker.",
  });

  /**
   * Makes the mocked client behave like the real one: no tags until its
   * detection grants them, and the tag list only with the capability.
   */
  function mockDetection(result: () => Promise<StoreCapabilities>) {
    let tags = false;
    let known = false;
    client.hasKnownCapabilities.mockImplementation(() => known);
    client.effectiveCapabilities.mockImplementation(() => ({
      tags,
      inventory: false,
      metafields: false,
    }));
    client.detectCapabilities.mockImplementation(() =>
      result().then((capabilities) => {
        tags = capabilities.tags;
        known = true;
        return capabilities;
      }),
    );
    client.filterValues.mockImplementation(async () => ({
      productTypes: ['snowboard'],
      tags: tags ? ['Premium', 'Winter'] : [],
    }));
  }

  async function openLimits(user: ReturnType<typeof userEvent.setup>) {
    await user.click(limitsToggle());
  }

  it('checks a store saved without capabilities before offering tags', async () => {
    let grant: (capabilities: StoreCapabilities) => void = () => {};
    const detection = new Promise<StoreCapabilities>((resolve) => {
      grant = resolve;
    });
    mockDetection(() => detection);
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [UNCHECKED_STORE],
    });
    await openLimits(user);

    // While the check runs, Tags waits for it instead of asking for a permission.
    expect(screen.queryByText(/enable "Read product tags"/)).toBeNull();
    await user.click(screen.getByLabelText('Tags'));
    expect(await screen.findByText('Loading tags…')).toBeVisible();
    expect(client.detectCapabilities).toHaveBeenCalledTimes(1);

    await act(async () => grant({ ...CAPABILITIES, tags: true }));
    // The tag list only comes with the capability, so it loads again.
    await waitFor(() => expect(client.filterValues).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Winter')).toBeVisible();
    expect(client.detectCapabilities).toHaveBeenCalledTimes(1);
  });

  it('reuses capabilities detected earlier in this tab', async () => {
    // The picker or the field editor already probed this connection.
    client.hasKnownCapabilities.mockReturnValue(true);
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [UNCHECKED_STORE],
    });
    await openLimits(user);

    expect(screen.getByLabelText('Tags')).toBeEnabled();
    expect(client.detectCapabilities).not.toHaveBeenCalled();
  });

  it('asks for the permission when the check finds none', async () => {
    mockDetection(async () => ({ ...CAPABILITIES, tags: false }));
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [UNCHECKED_STORE],
    });
    await openLimits(user);

    expect(await screen.findByText(/enable "Read product tags"/)).toBeVisible();
    expect(screen.getByLabelText('Tags')).toBeDisabled();
  });

  it('keeps offering tags when the check fails, and retries it', async () => {
    mockDetection(async () => ({ ...CAPABILITIES, tags: true }));
    client.detectCapabilities.mockRejectedValueOnce(NETWORK_ERROR);
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [UNCHECKED_STORE],
    });
    await openLimits(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn't reach Shopify/);
    expect(screen.getByLabelText('Tags')).toBeEnabled();
    expect(screen.queryByText(/enable "Read product tags"/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(client.detectCapabilities).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // Only the lookup that failed runs again.
    expect(client.collections).toHaveBeenCalledTimes(1);
  });

  it('asks for a token on a store connected without one', async () => {
    client.effectiveCapabilities.mockReturnValue({
      tags: false,
      inventory: false,
      metafields: false,
    });
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [
        { ...UNCHECKED_STORE, storefrontAccessToken: '', tokenless: true },
      ],
    });
    await openLimits(user);

    expect(
      screen.getByText(
        'To limit choices by tag, connect this store with a Storefront access token in the plugin settings.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Tags')).toBeDisabled();
    expect(client.detectCapabilities).not.toHaveBeenCalled();
  });

  it('offers tags in demo mode without checking', async () => {
    client.effectiveCapabilities.mockImplementation(() => ({
      tags: DEMO_STORE.capabilities?.tags === true,
      inventory: false,
      metafields: false,
    }));
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [],
      useDemoStore: true,
    });
    await openLimits(user);

    expect(getShopifyClient).toHaveBeenCalledWith(DEMO_STORE);
    expect(screen.getByLabelText('Tags')).toBeEnabled();
    expect(screen.queryByText(/enable "Read product tags"/)).toBeNull();
    expect(client.detectCapabilities).not.toHaveBeenCalled();
  });
});

describe('FieldConfigScreen: errors and hints for assistive tech', () => {
  it('points each limit at its own error and hint', () => {
    setup({
      parameters: { ...REFERENCE, cardinality: 'multiple', min: 5, max: 2 },
      errors: { min: "Minimum can't be greater than maximum" },
    });

    const min = screen.getByLabelText('Minimum items');
    expect(min).toHaveAttribute('aria-invalid', 'true');
    expect(min).toHaveAccessibleDescription(
      "Minimum can't be greater than maximum Optional. Below it, editors see a warning.",
    );
    const max = screen.getByLabelText('Maximum items');
    expect(max).not.toHaveAttribute('aria-invalid');
    expect(max).toHaveAccessibleDescription(
      "Optional. Editors can't add more items.",
    );
  });

  it('marks each radio group invalid with its error', () => {
    setup({
      parameters: { ...REFERENCE, cardinality: 'multiple' },
      errors: {
        kind: 'Choose products, variants or collections',
        cardinality: 'Choose one or multiple',
      },
    });

    const kind = group('Editors pick');
    expect(kind).toHaveAttribute('aria-invalid', 'true');
    expect(kind).toHaveAccessibleDescription(
      'Choose products, variants or collections',
    );
    // Each option's hint is part of its name.
    expect(
      within(kind).getByRole('radio', { name: /^Products/ }),
    ).toHaveAccessibleName(
      'Products A product with all its variants, prices and images.',
    );

    expect(group('Stored value')).not.toHaveAttribute('aria-invalid');

    const many = group('How many');
    expect(many).toHaveAttribute('aria-invalid', 'true');
    expect(many).toHaveAccessibleDescription('Choose one or multiple');
    expect(radio('Multiple')).toHaveAccessibleName(
      'Multiple Editors pick several products and put them in order.',
    );
  });

  it('describes the store choice by its error and hint, also after a pick', async () => {
    const { user } = setup({
      parameters: { ...REFERENCE, shopDomain: 'gone.myshopify.com' },
    });
    const stores = group('Store');
    expect(stores).toHaveAttribute('aria-invalid', 'true');
    expect(stores).toHaveAccessibleDescription(
      /^gone\.myshopify\.com isn't in the plugin settings anymore\. Choose another store\. Editors browse this store\./,
    );

    await user.click(storeRadio(/^EU store \(default\)/));
    expect(group('Store')).toHaveAccessibleDescription(
      /^Editors browse this store\./,
    );
    expect(group('Store')).not.toHaveAttribute('aria-invalid');
  });

  it('describes a select by its hint, with or without a value', async () => {
    const { user } = setup({ parameters: { ...REFERENCE } });
    await user.click(limitsToggle());
    const hint = 'Editors only see products from this collection.';
    expect(screen.getByLabelText('Collection')).toHaveAccessibleDescription(
      hint,
    );

    await user.click(screen.getByLabelText('Collection'));
    await user.click(await screen.findByRole('option', { name: /Hydrogen/ }));
    expect(screen.getByLabelText('Collection')).toHaveAccessibleDescription(
      hint,
    );
  });

  it('keeps the limits open with the error the host flags', async () => {
    client.browseCollectionProducts.mockResolvedValue({
      found: false,
      page: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      filters: [],
    });
    setup({
      parameters: {
        ...REFERENCE,
        scope: {
          collectionId: 'gid://shopify/Collection/9',
          collectionTitle: 'Gone',
        },
      },
      errors: { scope: 'Limits apply to products and variants only' },
    });

    // No toggle while the error shows: the fields can't be hidden.
    expect(screen.queryByRole('button', { name: /^Limit choices/ })).toBeNull();
    expect(
      alertWith('Limits apply to products and variants only'),
    ).toBeVisible();
    expect(
      await screen.findByText(
        'Not visible to the storefront: it may be unpublished from the Headless channel, or deleted.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Collection')).toHaveAccessibleDescription(
      'Editors only see products from this collection.',
    );
    expect(screen.getByLabelText('Product type')).toHaveAccessibleDescription(
      'Editors only see products of this type.',
    );
    expect(screen.getByLabelText('Tags')).toHaveAccessibleDescription(
      'With several tags, editors see products that have any of them.',
    );
    expect(screen.getByLabelText('Vendor')).toHaveAccessibleDescription(
      'Editors only see products from this vendor. Shopify matches whole words, so "Acme" also matches "Acme Outlet".',
    );
    expect(
      screen.getByLabelText('Only show products available for sale'),
    ).toHaveAccessibleDescription('The picker hides sold-out products.');
  });

  it('closes the limits once the host error is fixed', async () => {
    const parameters = { ...REFERENCE, scope: { vendor: 'Acme' } };
    const { user, rerenderWith } = setup({
      parameters,
      errors: { scope: 'Limits apply to products and variants only' },
    });
    expect(screen.queryByRole('button', { name: /^Limit choices/ })).toBeNull();

    rerenderWith(parameters, {});
    expect(limitsToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Vendor')).toHaveValue('Acme');
    await user.click(limitsToggle());
    expect(limitsToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the snapshot switch invalid with its error', () => {
    setup({
      parameters: { ...REFERENCE, snapshot: true },
      errors: { snapshot: 'Snapshots need the reference document format' },
    });
    const toggle = screen.getByRole('checkbox', {
      name: 'Include a display snapshot',
    });
    expect(toggle).toHaveAttribute('aria-invalid', 'true');
    expect(toggle).toHaveAccessibleDescription(
      /^Snapshots need the reference document format Each reference/,
    );
  });
});

describe('FieldConfigScreen: stores and example', () => {
  it('offers a store choice only with several stores', async () => {
    setup({ parameters: { ...REFERENCE } });
    expect(screen.queryByLabelText('Store')).toBeNull();
    cleanup();

    const { user, lastWrite } = setup({
      parameters: {
        ...REFERENCE,
        scope: { collectionId: 'gid://shopify/Collection/1', vendor: 'Acme' },
      },
      stores: [EU_STORE, US_STORE],
    });
    expect(storeRadio(/^EU store \(default\)/)).toBeChecked();
    await waitFor(() => expect(client.collections).toHaveBeenCalled());

    // A few stores are radios; a labelled store has its domain as the hint.
    const us = storeRadio(/^US store/);
    expect(us).toHaveAccessibleName('US store acme-us.myshopify.com');
    await user.click(us);
    expect(lastWrite()).toEqual({
      ...REFERENCE,
      shopDomain: 'acme-us.myshopify.com',
      scope: { vendor: 'Acme' },
    });
    expect(JSON.parse(example()).shop).toBe('acme-us.myshopify.com');
    // Lookups follow the field's store.
    await waitFor(() => expect(usClient.collections).toHaveBeenCalled());
    expect(usClient.filterValues).toHaveBeenCalled();
  });

  it('keeps the limits when picking the store already shown', async () => {
    const scope = {
      collectionId: 'gid://shopify/Collection/1',
      collectionTitle: 'Hydrogen',
    };
    const { user, setParameters } = setup({
      parameters: { ...REFERENCE, scope },
      stores: [EU_STORE, US_STORE],
    });
    await screen.findByText(/Editors only see products from this collection/);

    // The store shown is the checked radio: picking it again changes nothing.
    await user.click(storeRadio(/^EU store \(default\)/));

    expect(setParameters).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Editors only see products from this collection/),
    ).toBeVisible();
    expect(screen.queryByText(/Existing records point to/)).toBeNull();
    expect(usClient.collections).not.toHaveBeenCalled();
  });

  it('lists many stores in a select', async () => {
    const stores = [EU_STORE, US_STORE].concat(
      [1, 2, 3, 4].map((index) => ({
        ...US_STORE,
        shopDomain: `acme-${index}.myshopify.com`,
        label: `Store ${index}`,
      })),
    );
    const { user, lastWrite } = setup({
      parameters: { ...REFERENCE },
      stores,
    });
    expect(screen.queryByRole('radiogroup', { name: 'Store' })).toBeNull();

    await user.click(screen.getByLabelText('Store'));
    // A labelled store shows its domain under its name in the menu.
    expect(
      await screen.findByRole('option', { name: /Store 3/ }),
    ).toHaveTextContent('acme-3.myshopify.com');
    await user.click(screen.getByRole('option', { name: /US store/ }));
    expect(lastWrite()).toEqual({
      ...REFERENCE,
      shopDomain: 'acme-us.myshopify.com',
    });
  });

  it('warns when a saved field moves to another store', async () => {
    const { user } = setup({
      parameters: { ...REFERENCE },
      stores: [EU_STORE, US_STORE],
    });

    await user.click(storeRadio(/^US store/));
    expect(
      alertWith(
        'Existing records point to items in EU store. Editors have to pick them again from the new store.',
      ),
    ).toBeVisible();
  });

  it('flags a field whose store was removed from the plugin settings', async () => {
    const { user, lastWrite } = setup({
      parameters: { ...REFERENCE, shopDomain: 'gone.myshopify.com' },
    });
    expect(
      screen.getByText(/gone.myshopify.com isn't in the plugin settings/),
    ).toBeVisible();
    // The removed store stays as the saved choice, disabled.
    const removed = storeRadio(/^gone\.myshopify\.com \(removed\)/);
    expect(removed).toBeChecked();
    expect(removed).toBeDisabled();

    await user.click(storeRadio(/^EU store \(default\)/));
    expect(lastWrite()).toEqual({
      ...REFERENCE,
      shopDomain: 'datocms-demo.myshopify.com',
    });
    expect(storeRadio(/^EU store \(default\)/)).toBeChecked();
    expect(storeRadio(/^gone\.myshopify\.com \(removed\)/)).toBeDisabled();
    expect(
      screen.getByText(/Existing records point to items in gone.myshopify.com/),
    ).toBeVisible();
  });

  it('copies the exact stored value', async () => {
    const { user } = setup({ parameters: { ...REFERENCE } });

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    const exact = buildExampleStoredValue(
      'json',
      REFERENCE,
      EU_STORE.shopDomain,
    );
    expect(copyToClipboard).toHaveBeenCalledWith(exact);
    expect(JSON.parse(example())).toEqual(JSON.parse(exact));
    // The feedback stays in the button.
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeVisible();
    expect(
      screen.getByText(
        'Resolve the IDs with the Storefront API to render live data.',
      ),
    ).toBeVisible();
  });

  it('shows a string value exactly as it is stored', async () => {
    const { user } = setup({
      fieldType: 'string',
      parameters: { ...REFERENCE, format: 'gid' },
    });
    // A short value: a read-only field, with no code box.
    expect(
      screen.queryByRole('region', { name: 'Stored value example' }),
    ).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Stored value example' }),
    ).toHaveAttribute('readonly');
    expect(example()).toBe('gid://shopify/Product/10080752009562');
    expect(
      screen.getByText(
        'The Shopify ID of the selected product, as a plain string.',
      ),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyToClipboard).toHaveBeenCalledWith(
      'gid://shopify/Product/10080752009562',
    );
  });

  it('shortens long strings in the example, not in the copied value', async () => {
    const { user } = setup({ parameters: { ...REFERENCE, snapshot: true } });

    const shown: string = JSON.parse(example()).references[0].snapshot.imageUrl;
    expect(shown).toContain('…');
    expect(shown.length).toBeLessThanOrEqual(44);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    const copied = JSON.parse(
      vi.mocked(copyToClipboard).mock.lastCall?.[0] ?? '{}',
    );
    expect(copied.references[0].snapshot.imageUrl).toMatch(
      /^https:\/\/cdn\.shopify\.com\/[^…]+$/,
    );
  });

  it('uses a placeholder shop in the example without a store', () => {
    setup({ parameters: { ...REFERENCE }, stores: [] });
    expect(JSON.parse(example()).shop).toBe('your-store.myshopify.com');
  });
});

describe('FieldConfigScreen: invalid saved settings', () => {
  it('offers to write valid settings for variants saved as handles', async () => {
    const parameters = { ...REFERENCE, kind: 'variant', format: 'handle' };
    const errors = validateFieldParameters(parameters);
    const { user, lastWrite, setParameters } = setup({
      fieldType: 'string',
      parameters,
      errors,
    });

    const alert = alertWith(errors.kind ?? 'missing error');
    expect(alert).toHaveTextContent(/closest valid settings/);
    expect(radio('Products')).toBeChecked();
    // The error is about the saved combination, not the corrected control.
    expect(group('Editors pick')).not.toHaveAttribute('aria-invalid');
    expect(setParameters).not.toHaveBeenCalled();

    // The action sits under the callout, never inside it.
    expect(within(alert).queryByRole('button')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Use these settings' }),
    );
    expect(lastWrite()).toEqual({ ...REFERENCE, format: 'handle' });
  });

  it('offers to write valid settings when a hidden option is invalid', async () => {
    const parameters = { ...REFERENCE, cardinality: 'multiple', format: 'gid' };
    const errors = validateFieldParameters(parameters);
    const { user, lastWrite } = setup({
      fieldType: 'string',
      parameters,
      errors,
    });

    expect(screen.queryByRole('radiogroup', { name: 'How many' })).toBeNull();
    expect(
      alertWith('Multiple items can only be stored in a reference document'),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Use these settings' }),
    );
    expect(lastWrite()).toEqual({ ...REFERENCE, format: 'gid' });
  });

  it('offers no repair when the controls show the saved settings', () => {
    setup({
      parameters: { ...REFERENCE, cardinality: 'multiple', min: 5, max: 2 },
      errors: { min: "Minimum can't be greater than maximum" },
    });
    expect(
      screen.queryByRole('button', { name: 'Use these settings' }),
    ).toBeNull();
  });
});

describe('field config draft helpers', () => {
  it('parses limits', () => {
    expect(parseLimit('')).toBeUndefined();
    expect(parseLimit(' 3 ')).toBe(3);
    expect(parseLimit('-1')).toBe(-1);
    expect(parseLimit('1.5')).toBe('1.5');
  });

  it('writes limits only for multiple fields', () => {
    expect(
      parametersFromDraft({
        params: { ...REFERENCE },
        limits: { min: '1', max: '2' },
      }),
    ).toEqual(REFERENCE);
  });

  it('keeps variants and multiple when switching between reference and GID', () => {
    const params = withFormat(
      {
        ...REFERENCE,
        kind: 'variant',
        cardinality: 'multiple',
        snapshot: true,
      },
      'gid',
      'string',
    );
    expect(params).toEqual({ ...REFERENCE, kind: 'variant', format: 'gid' });
  });

  it('clears the default store back to undefined', () => {
    expect(
      withStore(
        { ...REFERENCE, shopDomain: 'a.myshopify.com' },
        undefined,
        'json',
      ),
    ).toEqual(REFERENCE);
  });
});

describe('field config change detection', () => {
  const plugin = normalizePluginParameters(
    pluginParameters([EU_STORE, US_STORE]),
  );

  it('keeps the collection when the chosen store is the one in use', () => {
    const scope = {
      collectionId: 'gid://shopify/Collection/1',
      collectionTitle: 'Hydrogen',
    };
    expect(
      withStore(
        { ...REFERENCE, scope },
        'a.myshopify.com',
        'json',
        'A.myshopify.com',
      ),
    ).toEqual({ ...REFERENCE, shopDomain: 'a.myshopify.com', scope });
    expect(
      withStore(
        { ...REFERENCE, scope },
        'b.myshopify.com',
        'json',
        'a.myshopify.com',
      ),
    ).toEqual({ ...REFERENCE, shopDomain: 'b.myshopify.com' });
  });

  it('lists what a saved field change affects', () => {
    expect(
      changesSinceSaved(
        REFERENCE,
        { ...REFERENCE, shopDomain: US_STORE.shopDomain },
        plugin,
      ),
    ).toEqual({ format: false, cardinality: false, previousStore: 'EU store' });
    expect(
      changesSinceSaved(
        REFERENCE,
        { ...REFERENCE, shopDomain: EU_STORE.shopDomain },
        plugin,
      ),
    ).toEqual({ format: false, cardinality: false, previousStore: null });
    expect(
      changesSinceSaved(
        { ...REFERENCE, cardinality: 'multiple' },
        { ...REFERENCE, format: 'legacyProductJson' },
        plugin,
      ),
    ).toEqual({ format: true, cardinality: false, previousStore: null });
  });

  it('reads saved parameters only from this extension', () => {
    expect(
      savedParametersOf(
        fieldEntity('1', 'json', { ...REFERENCE }),
        PLUGIN_ID,
        FIELD_EXTENSION_ID,
      ),
    ).toEqual(REFERENCE);
    expect(
      savedParametersOf(
        fieldEntity('1', 'json', 'other-editor'),
        PLUGIN_ID,
        FIELD_EXTENSION_ID,
      ),
    ).toEqual({});
    expect(
      savedParametersOf(undefined, PLUGIN_ID, FIELD_EXTENSION_ID),
    ).toBeUndefined();
  });
});
