import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FieldExtension from '../src/entrypoints/FieldExtension';
import {
  CentraClient,
  type HydratedCentraReference,
} from '../src/lib/centraClient';
import { canvasCtx } from './canvasCtx';

afterEach(cleanup);

const connection = {
  endpoint: 'https://example.centra.test/store-dtc-api-no-session',
  token: 'test-token',
};

const MULTIPLE_PRODUCTS = {
  paramsVersion: '1',
  kind: 'primaryProduct',
  cardinality: 'multiple',
};

function createCtx(
  overrides: Partial<{
    disabled: boolean;
    value: unknown;
    parameters: Record<string, unknown>;
    openModalResult: unknown;
  }> = {},
) {
  const setFieldValue = vi.fn(async (_path: string, _value: unknown) => {});
  const openModal = vi.fn(
    async (_options: Record<string, unknown>) =>
      overrides.openModalResult ?? null,
  );
  const ctx = {
    ...canvasCtx(),
    mode: 'renderFieldExtension',
    parameters: overrides.parameters ?? {
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    },
    plugin: {
      id: 'centra-plugin',
      attributes: { parameters: { paramsVersion: '2', ...connection } },
    },
    environment: 'main',
    isEnvironmentPrimary: true,
    currentRole: { meta: { final_permissions: { can_edit_schema: true } } },
    field: { attributes: { field_type: 'json' } },
    fieldPath: 'centra_reference',
    formValues: { centra_reference: overrides.value ?? null },
    disabled: overrides.disabled ?? false,
    setFieldValue,
    openModal,
  } as unknown as RenderFieldExtensionCtx;

  return { ctx, openModal, setFieldValue };
}

function documentOf(displayItemIds: number[]) {
  return JSON.stringify({
    version: 1,
    kind: 'primaryProduct',
    references: displayItemIds.map((displayItemId) => ({ displayItemId })),
  });
}

function savedDocument(displayItemIds: number[]) {
  return JSON.stringify(
    {
      version: 1,
      kind: 'primaryProduct',
      references: displayItemIds.map((displayItemId) => ({ displayItemId })),
    },
    null,
    2,
  );
}

function resolved(id: number, name: string): HydratedCentraReference {
  return {
    status: 'resolved',
    reference: { displayItemId: id },
    displayItem: { id, name, isPrimaryVariant: true, media: [], items: [] },
    primaryDrift: false,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deferredHydration() {
  let resolve: (value: HydratedCentraReference[]) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<HydratedCentraReference[]>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, reject, resolve };
}

/** Opens the "⋮" of a row (the kit's trigger opens on mouse down). */
async function openRowMenu(title: string) {
  fireEvent.mouseDown(
    screen.getByRole('button', { name: `Actions for ${title}` }),
  );
  return screen.findByRole('menu');
}

/** Picks an option of a row's "⋮" (the kit's options pick on mouse down). */
async function pickRowAction(title: string, option: string) {
  const menu = await openRowMenu(title);
  fireEvent.mouseDown(within(menu).getByRole('menuitem', { name: option }));
}

function rowTitles(names: string[]) {
  return screen
    .getAllByText(new RegExp(`^(${names.join('|')})$`))
    .map((element) => element.textContent);
}

describe('FieldExtension', () => {
  it.each([
    ['primaryProduct', 'single', 'No product yet', 'Choose product'],
    ['variant', 'single', 'No product variant yet', 'Choose product variant'],
    ['item', 'single', 'No SKU yet', 'Choose SKU'],
    ['primaryProduct', 'multiple', 'No products yet', 'Add products'],
    ['variant', 'multiple', 'No product variants yet', 'Add product variants'],
    ['item', 'multiple', 'No SKUs yet', 'Add SKUs'],
  ] as const)('shows the empty slot of %s %s fields', (kind, cardinality, message, action) => {
    const { ctx } = createCtx({
      parameters: { paramsVersion: '1', kind, cardinality },
    });

    render(<FieldExtension ctx={ctx} />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(`${action}$`) }),
    ).toBeInTheDocument();
  });

  it('persists only stable versioned IDs returned by the picker', async () => {
    const { ctx, openModal, setFieldValue } = createCtx({
      openModalResult: { references: [{ displayItemId: 2752 }] },
    });

    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose product$/ }));

    await waitFor(() => expect(openModal).toHaveBeenCalledOnce());
    const modalOptions = openModal.mock.calls[0]?.[0];
    expect(() => JSON.stringify(modalOptions?.parameters)).not.toThrow();
    expect(modalOptions?.initialHeight).toBe(730);
    expect(modalOptions?.title).toBe('Select Centra product');
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'centra_reference',
        savedDocument([2752]),
      ),
    );
  });

  it('offers no changes on a disabled field', async () => {
    const empty = createCtx({ disabled: true });
    render(<FieldExtension ctx={empty.ctx} />);

    expect(screen.getByText('No product yet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByText('No product yet'));
    expect(empty.openModal).not.toHaveBeenCalled();
    expect(screen.getByText('This field is read-only.')).toBeInTheDocument();
    cleanup();

    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockResolvedValue([
      resolved(2752, 'Dog Toy'),
      resolved(558, 'Elina_UK'),
    ]);
    const filled = createCtx({
      disabled: true,
      parameters: MULTIPLE_PRODUCTS,
      value: documentOf([2752, 558]),
    });
    render(<FieldExtension ctx={filled.ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('This field is read-only.')).toBeInTheDocument();
  });

  it('reorders with Move down at once and keeps the order until the value arrives', async () => {
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValue([
        resolved(2752, 'Dog Toy'),
        resolved(558, 'Elina_UK'),
      ]);
    const { ctx, setFieldValue } = createCtx({
      parameters: MULTIPLE_PRODUCTS,
      value: documentOf([2752, 558]),
    });

    const { rerender } = render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: 'Add products' });
    expect(addButton.querySelector('svg')).toBeInTheDocument();

    const menu = await openRowMenu('Dog Toy');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((option) => option.textContent),
    ).toEqual(['Replace', 'Move down', 'Remove']);
    fireEvent.mouseDown(
      within(menu).getByRole('menuitem', { name: 'Move down' }),
    );

    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'centra_reference',
        savedDocument([558, 2752]),
      ),
    );
    expect(rowTitles(['Dog Toy', 'Elina_UK'])).toEqual(['Elina_UK', 'Dog Toy']);

    rerender(
      <FieldExtension
        ctx={
          {
            ...ctx,
            formValues: { centra_reference: documentOf([558, 2752]) },
          } as RenderFieldExtensionCtx
        }
      />,
    );

    await act(async () => Promise.resolve());
    expect(rowTitles(['Dog Toy', 'Elina_UK'])).toEqual(['Elina_UK', 'Dog Toy']);
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it('removes a reference from its menu', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockResolvedValue([
      resolved(2752, 'Dog Toy'),
      resolved(558, 'Elina_UK'),
    ]);
    const { ctx, setFieldValue } = createCtx({
      parameters: MULTIPLE_PRODUCTS,
      value: documentOf([2752, 558]),
    });
    render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Elina_UK')).toBeInTheDocument();
    await pickRowAction('Elina_UK', 'Remove');

    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'centra_reference',
        savedDocument([2752]),
      ),
    );
  });

  it('refuses a replacement that is already in the field', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockResolvedValue([
      resolved(2752, 'Dog Toy'),
      resolved(558, 'Elina_UK'),
    ]);
    const { ctx, openModal, setFieldValue } = createCtx({
      parameters: MULTIPLE_PRODUCTS,
      value: documentOf([2752, 558]),
      openModalResult: { references: [{ displayItemId: 558 }] },
    });
    render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    await pickRowAction('Dog Toy', 'Replace');

    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith(
        'That product is already in this field.',
      ),
    );
    const modalOptions = openModal.mock.calls[0]?.[0];
    expect(modalOptions?.title).toBe('Select Centra product');
    expect(modalOptions?.parameters).toEqual({
      fieldParameters: { ...MULTIPLE_PRODUCTS, cardinality: 'single' },
      references: [{ displayItemId: 2752 }],
    });
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('shows one loading state, never the bare IDs, during the first hydration', async () => {
    const pending = deferredHydration();
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockReturnValue(
      pending.promise,
    );
    const { ctx } = createCtx({ value: documentOf([2752]) });

    render(<FieldExtension ctx={ctx} />);

    expect(screen.getByText('Loading the products')).toBeInTheDocument();
    expect(screen.queryByText('Unknown product')).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve([resolved(2752, 'Dog Toy')]);
      await pending.promise;
    });

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    expect(screen.queryByText('Loading the products')).not.toBeInTheDocument();
  });

  it('keeps hydrated rows while a new reference loads, and shows its ID on failure', async () => {
    const pending = deferredHydration();
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValueOnce([resolved(2752, 'Dog Toy')])
      .mockReturnValueOnce(pending.promise);
    const { ctx } = createCtx({
      parameters: MULTIPLE_PRODUCTS,
      value: documentOf([2752]),
    });
    const { rerender } = render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();

    rerender(
      <FieldExtension
        ctx={
          {
            ...ctx,
            formValues: { centra_reference: documentOf([2752, 558]) },
          } as RenderFieldExtensionCtx
        }
      />,
    );

    await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Loading the product' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unknown product')).not.toBeInTheDocument();

    pending.reject(new Error('Centra is temporarily unavailable.'));

    expect(
      await screen.findByText("Couldn't load the products from Centra"),
    ).toBeInTheDocument();
    // The raw message stays out of the field
    expect(
      screen.queryByText(/Centra is temporarily unavailable/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'plugin settings' })).toBeVisible();
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(screen.getByText('Unknown product')).toBeInTheDocument();
    expect(screen.getByText('558')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('preserves an unsupported document without rewriting it', () => {
    const { ctx, setFieldValue } = createCtx({
      value: JSON.stringify({
        version: 2,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }],
      }),
    });
    render(<FieldExtension ctx={ctx} />);

    expect(
      screen.getByText("Can't show what's saved in this field"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A newer version of the Centra plugin saved it/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear field' })).toBeVisible();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('warns without changing a product whose primary variant drifted', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockResolvedValue([
      {
        status: 'resolved',
        reference: { displayItemId: 2752 },
        displayItem: {
          id: 2752,
          name: 'Dog Toy',
          isPrimaryVariant: false,
          media: [],
          items: [],
        },
        primaryDrift: true,
      },
    ]);
    const { ctx, setFieldValue } = createCtx({ value: documentOf([2752]) });

    render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Main variant changed')).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('keeps saved IDs visible when live hydration fails', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockRejectedValue(
      new Error('Centra is temporarily unavailable.'),
    );
    const { ctx, setFieldValue } = createCtx({
      parameters: MULTIPLE_PRODUCTS,
      value: documentOf([2752, 558]),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(
      await screen.findByText("Couldn't load the products from Centra"),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Unknown product')).toHaveLength(2);
    expect(screen.getByText('2752')).toBeInTheDocument();
    expect(screen.getByText('558')).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('shows a concise product-first summary for a resolved SKU', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockResolvedValue([
      {
        status: 'resolved',
        reference: { displayItemId: 558, itemId: 'item-s' },
        displayItem: {
          id: 558,
          name: 'Elina_UK',
          productNumber: 'ELINA',
          productVariant: { name: 'Black', number: 'ELINA-BLACK' },
          available: true,
          price: {
            value: 120,
            formattedValue: '£120.00',
            currency: { code: 'GBP' },
          },
          media: [],
          items: [],
        },
        item: {
          id: 'item-s',
          name: 'S',
          sku: 'ELINA-BLACK',
          GTIN: '1234567890',
          stock: { available: true },
          preorder: false,
        },
        primaryDrift: false,
      },
    ]);
    const { ctx } = createCtx({
      parameters: { paramsVersion: '1', kind: 'item', cardinality: 'multiple' },
      value: JSON.stringify({
        version: 1,
        kind: 'item',
        references: [{ displayItemId: 558, itemId: 'item-s' }],
      }),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Elina_UK')).toBeInTheDocument();
    expect(
      screen.getByText('S · Black · SKU ELINA-BLACK · £120.00'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/GTIN/)).not.toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
    expect(screen.queryByText(/Item item-s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DisplayItem 558/)).not.toBeInTheDocument();
  });

  it('does not restart hydration for an equivalent SDK context object', async () => {
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValue([resolved(2752, 'Dog Toy')]);
    const { ctx } = createCtx({ value: documentOf([2752]) });
    const { rerender } = render(<FieldExtension ctx={ctx} />);

    await waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    const firstSignal = hydrate.mock.calls[0]?.[0].signal;
    const equivalentCtx = {
      ...ctx,
      parameters: cloneJson(ctx.parameters),
      plugin: {
        ...ctx.plugin,
        attributes: {
          ...ctx.plugin.attributes,
          parameters: cloneJson(ctx.plugin.attributes.parameters),
        },
      },
      formValues: cloneJson(ctx.formValues),
    } as RenderFieldExtensionCtx;

    rerender(<FieldExtension ctx={equivalentCtx} />);

    expect(hydrate).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(false);
  });
});
