import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import type { ChangeEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PickerModal from '../src/entrypoints/PickerModal';
import { CentraClient, type CentraDisplayItem } from '../src/lib/centraClient';
import type { CentraFieldParametersV1 } from '../src/types';

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Spinner: () => <span>Loading</span>,
  TextInput: ({
    labelText,
    type,
    value,
    onChange,
  }: {
    labelText?: string;
    type?: 'text' | 'search';
    value?: string;
    onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <input
      aria-label={labelText}
      type={type}
      value={value}
      onChange={(event) => onChange?.(event.target.value, event)}
    />
  ),
}));

const scrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoView,
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockReset();
  vi.restoreAllMocks();
});

const connection = {
  endpoint: 'https://example.centra.test/store-dtc-api-no-session',
  token: 'test-token',
};

const displayItem: CentraDisplayItem = {
  id: 2752,
  name: 'Dog Toy',
  productNumber: '54321',
  isPrimaryVariant: true,
  available: true,
  hasStock: true,
  productVariant: { name: 'Default', number: '54321R001' },
  media: [],
  price: {
    value: 12,
    formattedValue: '€12.00',
    currency: { code: 'EUR' },
  },
  items: [],
};

function createCtx(fieldParameters: CentraFieldParametersV1) {
  const resolve = vi.fn();
  const setHeight = vi.fn();
  const ctx = {
    parameters: {
      fieldParameters,
      references: [],
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
    resolve,
    setHeight,
  } as unknown as RenderModalCtx;
  return { ctx, resolve, setHeight };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('PickerModal', () => {
  it('uses a fixed-height frame so catalog results scroll inside the modal', async () => {
    vi.spyOn(CentraClient.prototype, 'searchDisplayItems').mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
    });
    const { ctx, setHeight } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    await waitFor(() => expect(setHeight).toHaveBeenCalledWith(730));
  });

  it('shows shape-stable catalog skeletons during the initial request', () => {
    vi.spyOn(CentraClient.prototype, 'searchDisplayItems').mockImplementation(
      () =>
        new Promise(() => {
          // Deliberately pending so the loading surface can be inspected.
        }),
    );
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    expect(
      screen.getByRole('status', { name: 'Loading Centra catalog' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Picker actions' }),
    ).toBeInTheDocument();
  });

  it('stages a product selection until Apply', async () => {
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockResolvedValue({
        items: [displayItem],
        page: 1,
        hasMore: false,
        totalCount: 1,
      });
    const { ctx, resolve } = createCtx({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    });

    render(<PickerModal ctx={ctx} />);
    const selectButton = await screen.findByRole('button', {
      name: 'Select Dog Toy',
    });
    expect(selectButton).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton).not.toHaveAttribute('aria-expanded');
    expect(selectButton).not.toHaveAttribute('aria-controls');
    fireEvent.click(selectButton);
    expect(
      screen.getByRole('button', { name: 'Remove Dog Toy' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }));

    expect(resolve).toHaveBeenCalledWith({
      references: [{ displayItemId: 2752 }],
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'primaryProduct',
        page: 1,
      }),
    );
  });

  it('selects an exact product variant when its card content is clicked', async () => {
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockResolvedValue({
        items: [displayItem],
        page: 1,
        hasMore: false,
        totalCount: 1,
      });
    const { ctx, resolve } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'single',
    });

    render(<PickerModal ctx={ctx} />);

    fireEvent.click(await screen.findByText('Dog Toy'));
    expect(
      screen.getByRole('button', { name: 'Remove Dog Toy' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(resolve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }));

    expect(resolve).toHaveBeenCalledWith({
      references: [{ displayItemId: 2752 }],
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'variant', page: 1 }),
    );
  });

  it('shows every duplicate SKU and stores the chosen immutable item ID', async () => {
    vi.spyOn(CentraClient.prototype, 'searchItems').mockResolvedValue({
      items: [
        {
          ...displayItem,
          items: [
            {
              id: 'item-1',
              name: 'Small',
              sku: 'SHARED-SKU',
              stock: { available: true },
            },
            {
              id: 'item-2',
              name: 'Medium',
              sku: 'SHARED-SKU',
              stock: { available: true },
            },
          ],
        },
      ],
      page: 1,
      hasMore: false,
      totalCount: 1,
    });
    const { ctx, resolve } = createCtx({
      paramsVersion: '1',
      kind: 'item',
      cardinality: 'single',
    });

    render(<PickerModal ctx={ctx} />);
    const chooseSkuButton = await screen.findByRole('button', {
      name: 'Choose SKU',
    });
    expect(chooseSkuButton).toHaveAttribute('aria-expanded', 'false');
    expect(chooseSkuButton).toHaveAttribute(
      'aria-controls',
      'centra-display-item-2752-items',
    );
    expect(chooseSkuButton).not.toHaveAttribute('aria-pressed');
    expect(
      document.getElementById('centra-display-item-2752-items'),
    ).toHaveAttribute('hidden');
    const productArticle = screen.getByRole('article');
    const closedClassName = productArticle.className;
    expect(productArticle).toHaveAttribute('data-layout', 'drilldown');
    fireEvent.click(chooseSkuButton);
    const hideSkuButton = screen.getByRole('button', { name: 'Hide SKUs' });
    expect(hideSkuButton).toHaveAttribute('aria-expanded', 'true');
    expect(hideSkuButton).toHaveAttribute(
      'aria-controls',
      'centra-display-item-2752-items',
    );
    expect(hideSkuButton).not.toHaveAttribute('aria-pressed');
    expect(
      document.getElementById('centra-display-item-2752-items'),
    ).not.toHaveAttribute('hidden');
    expect(productArticle.className).toBe(closedClassName);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText('Item item-1')).toBeInTheDocument();
    expect(screen.getByText('Item item-2')).toBeInTheDocument();
    const mediumSku = screen.getByRole('button', {
      name: /Medium.*Item item-2.*SHARED-SKU/,
    });
    fireEvent.click(mediumSku);
    expect(mediumSku).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('article')).not.toHaveAttribute('data-selected');
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }));

    expect(resolve).toHaveBeenCalledWith({
      references: [{ displayItemId: 2752, itemId: 'item-2' }],
    });
  });

  it('debounces search and aborts the superseded request signal', async () => {
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockResolvedValue({
        items: [displayItem],
        page: 1,
        hasMore: false,
      });
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const firstSignal = search.mock.calls[0]?.[0].signal;
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'dog toy' },
    });

    await waitFor(
      () =>
        expect(search).toHaveBeenLastCalledWith(
          expect.objectContaining({ query: 'dog toy' }),
        ),
      { timeout: 1_500 },
    );
    expect(firstSignal?.aborted).toBe(true);
  });

  it('keeps pagination in the action footer and appends the next page', async () => {
    const secondDisplayItem: CentraDisplayItem = {
      ...displayItem,
      id: 558,
      name: 'Elina_UK',
      productNumber: 'ELINA',
    };
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockImplementation(async ({ page }) =>
        page === 1
          ? {
              items: [displayItem],
              page: 1,
              hasMore: true,
              nextPage: 2,
              totalCount: 2,
            }
          : {
              items: [secondDisplayItem],
              page: 2,
              hasMore: false,
              totalCount: 2,
            },
      );
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    const footer = screen.getByRole('group', { name: 'Picker actions' });
    const loadMore = within(footer).getByRole('button', { name: 'Load more' });
    expect(
      within(footer).getByRole('button', { name: 'Cancel' }),
    ).toBeVisible();
    expect(
      within(footer).getByRole('button', { name: 'Apply selection' }),
    ).toBeVisible();

    fireEvent.click(loadMore);

    expect(await screen.findByText('Elina_UK')).toBeInTheDocument();
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('keeps current results mounted when loading another page fails', async () => {
    vi.spyOn(CentraClient.prototype, 'searchDisplayItems').mockImplementation(
      async ({ page }) => {
        if (page === 1) {
          return {
            items: [displayItem],
            page: 1,
            hasMore: true,
            nextPage: 2,
          };
        }
        throw new Error('The next page is temporarily unavailable.');
      },
    );
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);
    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(
      screen.getByText(/Loading more products failed/),
    ).toBeInTheDocument();
  });

  it('ranks an exact SKU match first inside the selected product', async () => {
    vi.spyOn(CentraClient.prototype, 'searchItems').mockResolvedValue({
      items: [
        {
          ...displayItem,
          items: [
            { id: 'item-other', name: 'Other', sku: 'OTHER-SKU' },
            { id: 'item-exact', name: 'Exact', sku: 'MATCH-ME' },
          ],
        },
      ],
      page: 1,
      hasMore: false,
    });
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'item',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'match-me' },
    });

    await screen.findByText('Item item-exact', {}, { timeout: 1_500 });
    const itemIds = screen
      .getAllByText(/^Item item-/)
      .map((element) => element.textContent);
    expect(itemIds).toEqual(['Item item-exact', 'Item item-other']);
  });

  it('does not restart search for an equivalent SDK context object', async () => {
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockResolvedValue({
        items: [displayItem],
        page: 1,
        hasMore: false,
      });
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });
    const { rerender } = render(<PickerModal ctx={ctx} />);

    await waitFor(() => expect(search).toHaveBeenCalledOnce());
    const firstSignal = search.mock.calls[0]?.[0].signal;
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
    } as RenderModalCtx;

    rerender(<PickerModal ctx={equivalentCtx} />);

    expect(search).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(false);
  });
});
