import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FieldExtension from '../src/entrypoints/FieldExtension';
import { CentraClient } from '../src/lib/centraClient';

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
  Button: ({
    children,
    disabled,
    leftIcon,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    leftIcon?: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {leftIcon}
      {children}
    </button>
  ),
  Spinner: () => <span>Loading</span>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const connection = {
  endpoint: 'https://example.centra.test/store-dtc-api-no-session',
  token: 'test-token',
};

function createCtx(
  overrides: Partial<{
    disabled: boolean;
    value: unknown;
    parameters: Record<string, unknown>;
    openModalResult: unknown;
  }> = {},
) {
  const setFieldValue = vi.fn().mockResolvedValue(undefined);
  const openModal = vi
    .fn()
    .mockResolvedValue(overrides.openModalResult ?? null);
  const ctx = {
    parameters: overrides.parameters ?? {
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    },
    plugin: {
      attributes: {
        parameters: {
          paramsVersion: '2',
          ...connection,
        },
      },
    },
    environment: 'primary',
    field: { attributes: { field_type: 'json' } },
    fieldPath: 'centra_reference',
    formValues: { centra_reference: overrides.value ?? null },
    disabled: overrides.disabled ?? false,
    setFieldValue,
    openModal,
    openConfirm: vi.fn().mockResolvedValue('cancel'),
  } as unknown as RenderFieldExtensionCtx;

  return { ctx, openModal, setFieldValue };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type HydrationResult = Awaited<ReturnType<CentraClient['hydrateReferences']>>;

function deferredHydration() {
  let resolve!: (value: HydrationResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<HydrationResult>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, reject, resolve };
}

describe('FieldExtension', () => {
  it.each([
    ['primaryProduct', 'single', 'No product specified', 'Choose product'],
    [
      'variant',
      'single',
      'No product variant specified',
      'Choose product variant',
    ],
    ['item', 'single', 'No SKU specified', 'Choose SKU'],
    ['primaryProduct', 'multiple', 'No products present', 'Choose product'],
    [
      'variant',
      'multiple',
      'No product variants present',
      'Choose product variant',
    ],
    ['item', 'multiple', 'No SKUs present', 'Choose SKU'],
  ] as const)('uses restrained empty copy for %s %s fields', (kind, cardinality, message, action) => {
    const { ctx } = createCtx({
      parameters: { paramsVersion: '1', kind, cardinality },
    });

    render(<FieldExtension ctx={ctx} />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
  });

  it('persists only stable versioned IDs returned by the picker', async () => {
    const { ctx, openModal, setFieldValue } = createCtx({
      openModalResult: { references: [{ displayItemId: 2752 }] },
    });

    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose product' }));

    await waitFor(() => expect(openModal).toHaveBeenCalledOnce());
    const modalOptions = openModal.mock.calls[0]?.[0];
    expect(() => JSON.stringify(modalOptions?.parameters)).not.toThrow();
    expect(modalOptions?.initialHeight).toBe(730);
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'centra_reference',
        JSON.stringify(
          {
            version: 1,
            kind: 'primaryProduct',
            references: [{ displayItemId: 2752 }],
          },
          null,
          2,
        ),
      ),
    );
  });

  it('does not expose mutations for a disabled field', () => {
    const { ctx, openModal } = createCtx({ disabled: true });
    render(<FieldExtension ctx={ctx} />);

    expect(
      screen.getByRole('button', { name: 'Choose product' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose product' }));
    expect(openModal).not.toHaveBeenCalled();
  });

  it('uses native-style add controls and keyboard-accessible drag sorting', async () => {
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValue([
        {
          status: 'resolved',
          reference: { displayItemId: 2752 },
          displayItem: {
            id: 2752,
            name: 'Dog Toy',
            isPrimaryVariant: true,
            media: [],
            items: [],
          },
          primaryDrift: false,
        },
        {
          status: 'resolved',
          reference: { displayItemId: 558 },
          displayItem: {
            id: 558,
            name: 'Elina_UK',
            isPrimaryVariant: true,
            media: [],
            items: [],
          },
          primaryDrift: false,
        },
      ]);
    const { ctx, setFieldValue } = createCtx({
      parameters: {
        paramsVersion: '1',
        kind: 'primaryProduct',
        cardinality: 'multiple',
      },
      value: JSON.stringify({
        version: 1,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }, { displayItemId: 558 }],
      }),
    });

    const rectangle = (left: number): DOMRect =>
      ({
        x: left,
        y: 0,
        top: 0,
        left,
        right: left + 200,
        bottom: 240,
        width: 200,
        height: 240,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === 'centra-sortable-reference') {
          const sortables = Array.from(
            document.querySelectorAll(
              '[data-testid="centra-sortable-reference"]',
            ),
          );
          return rectangle(sortables.indexOf(this) * 220);
        }
        return rectangle(0);
      },
    );

    const { rerender } = render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    expect(screen.getByText('Elina_UK')).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: 'Add products' });
    expect(addButton.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move (up|down)/ })).toBeNull();

    const [first, second] = screen.getAllByTestId('centra-sortable-reference');

    first.focus();
    fireEvent.keyDown(first, { code: 'Space' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.keyDown(document, { code: 'ArrowRight' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.keyDown(document, { code: 'Space' });

    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'centra_reference',
        JSON.stringify(
          {
            version: 1,
            kind: 'primaryProduct',
            references: [{ displayItemId: 558 }, { displayItemId: 2752 }],
          },
          null,
          2,
        ),
      ),
    );

    const optimisticOrder = screen.getAllByTestId('centra-sortable-reference');
    expect(optimisticOrder).toEqual([second, first]);

    const reorderedValue = JSON.stringify({
      version: 1,
      kind: 'primaryProduct',
      references: [{ displayItemId: 558 }, { displayItemId: 2752 }],
    });
    rerender(
      <FieldExtension
        ctx={
          {
            ...ctx,
            formValues: { centra_reference: reorderedValue },
          } as RenderFieldExtensionCtx
        }
      />,
    );

    await act(async () => Promise.resolve());
    expect(screen.getAllByTestId('centra-sortable-reference')).toEqual([
      second,
      first,
    ]);
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it('shows card-shaped skeletons instead of generic identities during first hydration', async () => {
    const pending = deferredHydration();
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockReturnValue(
      pending.promise,
    );
    const { ctx } = createCtx({
      value: JSON.stringify({
        version: 1,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }],
      }),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(screen.getByTestId('centra-reference-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Centra product')).not.toBeInTheDocument();
    expect(screen.queryByText('DisplayItem 2752')).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve([
        {
          status: 'resolved',
          reference: { displayItemId: 2752 },
          displayItem: {
            id: 2752,
            name: 'Dog Toy',
            isPrimaryVariant: true,
            media: [],
            items: [],
          },
          primaryDrift: false,
        },
      ]);
      await pending.promise;
    });

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    expect(
      screen.queryByTestId('centra-reference-skeleton'),
    ).not.toBeInTheDocument();
  });

  it('retains matching hydrated cards while a new reference loads and exposes its ID on failure', async () => {
    const pending = deferredHydration();
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValueOnce([
        {
          status: 'resolved',
          reference: { displayItemId: 2752 },
          displayItem: {
            id: 2752,
            name: 'Dog Toy',
            isPrimaryVariant: true,
            media: [],
            items: [],
          },
          primaryDrift: false,
        },
      ])
      .mockReturnValueOnce(pending.promise);
    const value = JSON.stringify({
      version: 1,
      kind: 'primaryProduct',
      references: [{ displayItemId: 2752 }],
    });
    const { ctx } = createCtx({
      parameters: {
        paramsVersion: '1',
        kind: 'primaryProduct',
        cardinality: 'multiple',
      },
      value,
    });
    const { rerender } = render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();

    const nextValue = JSON.stringify({
      version: 1,
      kind: 'primaryProduct',
      references: [{ displayItemId: 2752 }, { displayItemId: 558 }],
    });
    rerender(
      <FieldExtension
        ctx={
          {
            ...ctx,
            formValues: { centra_reference: nextValue },
          } as RenderFieldExtensionCtx
        }
      />,
    );

    await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(screen.getByTestId('centra-reference-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('DisplayItem 558')).not.toBeInTheDocument();

    pending.reject(new Error('Centra is temporarily unavailable.'));

    expect(
      await screen.findByText(/Live catalog details could not be loaded/),
    ).toBeInTheDocument();
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(screen.getByText('DisplayItem 558')).toBeInTheDocument();
    expect(
      screen.queryByTestId('centra-reference-skeleton'),
    ).not.toBeInTheDocument();
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

    expect(screen.getByText(/Saved value preserved/)).toBeInTheDocument();
    expect(
      screen.getByText(/unsupported Centra reference version 2/),
    ).toBeInTheDocument();
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
    const { ctx, setFieldValue } = createCtx({
      value: JSON.stringify({
        version: 1,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }],
      }),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(
      await screen.findByText(/no longer the primary variant/),
    ).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('keeps saved IDs visible when live hydration fails', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockRejectedValue(
      new Error('Centra is temporarily unavailable.'),
    );
    const { ctx, setFieldValue } = createCtx({
      parameters: {
        paramsVersion: '1',
        kind: 'primaryProduct',
        cardinality: 'multiple',
      },
      value: JSON.stringify({
        version: 1,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }, { displayItemId: 558 }],
      }),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(
      await screen.findByText(/Live catalog details could not be loaded/),
    ).toBeInTheDocument();
    expect(screen.getByText('DisplayItem 2752')).toBeInTheDocument();
    expect(screen.getByText('DisplayItem 558')).toBeInTheDocument();
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
      parameters: {
        paramsVersion: '1',
        kind: 'item',
        cardinality: 'multiple',
      },
      value: JSON.stringify({
        version: 1,
        kind: 'item',
        references: [{ displayItemId: 558, itemId: 'item-s' }],
      }),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(await screen.findByText('Elina_UK')).toBeInTheDocument();
    expect(
      screen.getByText(/S · Black · SKU ELINA-BLACK · £120.00/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/GTIN/)).not.toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
    expect(screen.queryByText(/Item item-s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DisplayItem 558/)).not.toBeInTheDocument();
  });

  it('does not restart hydration for an equivalent SDK context object', async () => {
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValue([
        {
          status: 'resolved',
          reference: { displayItemId: 2752 },
          displayItem: {
            id: 2752,
            name: 'Dog Toy',
            isPrimaryVariant: true,
            media: [],
            items: [],
          },
          primaryDrift: false,
        },
      ]);
    const value = JSON.stringify({
      version: 1,
      kind: 'primaryProduct',
      references: [{ displayItemId: 2752 }],
    });
    const { ctx } = createCtx({ value });
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
