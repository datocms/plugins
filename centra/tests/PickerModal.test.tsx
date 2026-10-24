import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PickerModal from '../src/entrypoints/PickerModal';
import {
  CentraClient,
  type CentraDisplayItem,
  type CentraItem,
} from '../src/lib/centraClient';
import type { CentraFieldParametersV1 } from '../src/types';
import { scrollToNearestEdge } from '../src/utils/scroll';
import { canvasCtx } from './canvasCtx';

// The picker scrolls its Pane content, which jsdom doesn't lay out.
vi.mock('../src/utils/scroll', () => ({
  scrollParent: vi.fn(() => null),
  scrollToNearestEdge: vi.fn(),
}));

afterEach(cleanup);

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

function withItems(items: CentraItem[]): CentraDisplayItem {
  return { ...displayItem, items };
}

function createCtx(fieldParameters: CentraFieldParametersV1) {
  const resolve = vi.fn();
  const setHeight = vi.fn();
  const ctx = {
    ...canvasCtx(),
    mode: 'renderModal',
    bodyPadding: [20, 20, 20, 20],
    parameters: {
      fieldParameters,
      references: [],
    },
    plugin: {
      id: 'centra-plugin',
      attributes: {
        parameters: {
          paramsVersion: '2',
          ...connection,
        },
      },
    },
    environment: 'main',
    isEnvironmentPrimary: true,
    resolve,
    setHeight,
  } as unknown as RenderModalCtx;
  return { ctx, resolve, setHeight };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The deepest element whose whole text is `text` (a text split by markup) */
function byWholeText(text: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === text &&
    Array.from(element.children).every((child) => child.textContent !== text);
}

/** The footer bar: the one that holds Apply selection */
function footer() {
  const apply = screen.getByRole('button', { name: 'Apply selection' });
  const bar = apply.parentElement;
  if (!bar) throw new Error('Apply selection has no bar');
  return bar;
}

function selectionStatus() {
  return within(footer()).getByRole('status');
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
    expect(
      await screen.findByText('No product variants found'),
    ).toBeInTheDocument();
  });

  it('shows a loading blank slate during the first request, with the footer', () => {
    vi.spyOn(CentraClient.prototype, 'searchDisplayItems').mockImplementation(
      () =>
        new Promise(() => {
          // Deliberately pending so the loading state can be inspected.
        }),
    );
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    expect(screen.getByText('Loading the products')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Apply selection' }),
    ).toBeInTheDocument();
    expect(selectionStatus()).toHaveTextContent('0 products selected');
  });

  it('stages a product selection until Apply, and a second click clears it', async () => {
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
    // A click on the row, or on its checkbox, toggles the product
    const checkbox = await screen.findByRole('checkbox', { name: /^Dog Toy/ });
    const row = screen.getByText('Dog Toy');
    // The count of the results leads the footer, before the selection
    expect(footer()).toHaveTextContent('1 product · 0 products selected');

    fireEvent.click(row);
    expect(checkbox).toBeChecked();
    expect(selectionStatus()).toHaveTextContent('1 product selected');
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(selectionStatus()).toHaveTextContent('0 products selected');
    fireEvent.click(row);
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

  it('selects an exact product variant when its row is clicked', async () => {
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
    expect(selectionStatus()).toHaveTextContent('1 product variant selected');
    expect(resolve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }));

    expect(resolve).toHaveBeenCalledWith({
      references: [{ displayItemId: 2752 }],
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'variant', page: 1 }),
    );
  });

  it('shows the product fallback title, its identity and its stock in its row', async () => {
    vi.spyOn(CentraClient.prototype, 'searchDisplayItems').mockResolvedValue({
      items: [
        {
          ...displayItem,
          name: undefined,
          productVariant: { number: '54321R001' },
          hasStock: false,
        },
      ],
      page: 1,
      hasMore: false,
    });
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    // Without a name, the product number titles the row.
    expect(
      await screen.findByRole('checkbox', { name: /^Product 54321/ }),
    ).not.toBeChecked();
    expect(screen.getByText('Product 54321')).toBeInTheDocument();
    expect(screen.getByText('Product 54321 · 54321R001')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.getByText('€12.00')).toBeInTheDocument();
  });

  it('opens the SKUs of a product and keeps duplicate SKUs apart by their item ID', async () => {
    vi.mocked(scrollToNearestEdge).mockClear();
    vi.spyOn(CentraClient.prototype, 'searchItems').mockResolvedValue({
      items: [
        withItems([
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
        ]),
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
    const toggle = await screen.findByRole('button', { name: /^Dog Toy/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('item-1')).not.toBeInTheDocument();
    expect(scrollToNearestEdge).not.toHaveBeenCalled();

    // A click on the product row opens its SKUs, as its toggle does
    fireEvent.click(screen.getByText('Dog Toy'));

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(scrollToNearestEdge).toHaveBeenCalled();
    expect(screen.getByText(byWholeText('Item item-1'))).toBeInTheDocument();
    expect(screen.getByText(byWholeText('Item item-2'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /^Medium/ }));
    expect(screen.getByRole('checkbox', { name: /^Medium/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Small/ })).not.toBeChecked();
    expect(selectionStatus()).toHaveTextContent('1 SKU selected');
    // The footer and the pill of the product
    expect(screen.getAllByText('1 SKU selected')).toHaveLength(2);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
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
    // The text filter is named by the Pane, as its search landmark
    const filter = screen.getByRole('search', { name: 'Product variants' });
    fireEvent.change(within(filter).getByRole('textbox'), {
      target: { value: 'dog toy' },
    });
    expect(search).toHaveBeenCalledTimes(1);

    await waitFor(
      () =>
        expect(search).toHaveBeenLastCalledWith(
          expect.objectContaining({ query: 'dog toy' }),
        ),
      { timeout: 1_500 },
    );
    expect(firstSignal?.aborted).toBe(true);
  });

  it('keeps the pagination in the footer and the staged selection across pages', async () => {
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
              totalCount: 48,
            }
          : {
              items: [secondDisplayItem],
              page: 2,
              hasMore: false,
              totalCount: 48,
            },
      );
    const { ctx, resolve } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /^Dog Toy/ }));
    const bar = footer();
    expect(bar).toHaveTextContent(
      '48 product variants · 1 product variant selected',
    );
    const pagination = within(bar).getByRole('navigation', {
      name: 'Product variants pagination',
    });
    expect(
      within(bar).queryByRole('button', { name: /Load more/ }),
    ).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(pagination).getByRole('button', { name: 'Go to page 2' }),
    );

    expect(await screen.findByText('Elina_UK')).toBeInTheDocument();
    expect(screen.queryByText('Dog Toy')).not.toBeInTheDocument();
    expect(selectionStatus()).toHaveTextContent('1 product variant selected');
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /^Elina_UK/ }));
    fireEvent.click(
      within(footer()).getByRole('button', { name: 'Apply selection' }),
    );
    expect(resolve).toHaveBeenCalledWith({
      references: [{ displayItemId: 2752 }, { displayItemId: 558 }],
    });
  });

  it('keeps the current page after a page failure and lets the pagination try again', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The next page is temporarily unavailable.',
    );
    expect(screen.getByText('Dog Toy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to page 2' })).toBeEnabled();
  });

  it('offers Try again when the first load fails, and runs the search again', async () => {
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockRejectedValueOnce(new Error('Centra answered 503.'))
      .mockResolvedValue({ items: [displayItem], page: 1, hasMore: false });
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);

    expect(
      await screen.findByText("Couldn't load the catalog"),
    ).toBeInTheDocument();
    expect(screen.getByText('Centra answered 503.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Dog Toy')).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('keeps an empty result and its count on screen while a new search loads', async () => {
    const empty = { items: [], page: 1, hasMore: false, totalCount: 0 };
    let settleSearch = (_result: typeof empty) => {};
    const search = vi
      .spyOn(CentraClient.prototype, 'searchDisplayItems')
      .mockResolvedValueOnce(empty)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            // Held open so the reload can be inspected.
            settleSearch = resolve;
          }),
      );
    const { ctx } = createCtx({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'multiple',
    });

    render(<PickerModal ctx={ctx} />);
    expect(await screen.findByText('No products found')).toBeInTheDocument();
    fireEvent.change(
      within(screen.getByRole('search', { name: 'Products' })).getByRole(
        'textbox',
      ),
      { target: { value: 'dog' } },
    );

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2), {
      timeout: 1_500,
    });
    expect(screen.getByText('No products found')).toBeInTheDocument();
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading the products')).not.toBeInTheDocument();
    expect(footer()).toHaveTextContent('0 products · 0 products selected');

    settleSearch(empty);
    expect(await screen.findByText('No results')).toBeInTheDocument();
  });

  it('opens an exact SKU match and ranks it first inside its product', async () => {
    vi.spyOn(CentraClient.prototype, 'searchItems').mockResolvedValue({
      items: [
        withItems([
          { id: 'item-other', name: 'Other', sku: 'OTHER-SKU' },
          { id: 'item-exact', name: 'Exact', sku: 'MATCH-ME' },
        ]),
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
    fireEvent.change(
      within(screen.getByRole('search', { name: 'Products' })).getByRole(
        'textbox',
      ),
      { target: { value: 'match-me' } },
    );

    await screen.findByText('item-exact', {}, { timeout: 1_500 });
    const itemIds = screen
      .getAllByText(/^item-/)
      .map((element) => element.textContent);
    expect(itemIds).toEqual(['item-exact', 'item-other']);
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
