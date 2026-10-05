import type { RawApiTypes } from '@datocms/cma-client-browser';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StagePage from '../src/entrypoints/StagePage';
import { readMenuItems } from '../src/lib/parameters';
import {
  buildField,
  buildItem,
  buildItemType,
  buildPageCtx,
  type PermissionRule,
} from './fixtures';

type Item = RawApiTypes.Item;

// An in-memory API: bulk actions change what the next reload returns.
let store: Item[] = [];

type BulkPayload = {
  data: {
    attributes?: { stage: string };
    relationships: { items: { data: { id: string }[] } };
  };
};

function bulk(apply: (item: Item, payload: BulkPayload) => void) {
  return async (payload: BulkPayload) => {
    const ids = new Set(payload.data.relationships.items.data.map((d) => d.id));
    for (const item of store.filter((candidate) => ids.has(candidate.id))) {
      apply(item, payload);
    }
    return { data: [], meta: { successful: ids.size, failed: 0 } };
  };
}

const client = {
  workflows: { find: vi.fn() },
  items: {
    rawList: vi.fn(
      async (query: {
        filter: {
          ids?: string;
          type?: string;
          fields?: { _stage: { eq: string } };
        };
        page?: { offset: number; limit: number };
      }) => {
        const { filter } = query;
        // The stage listing: one model's records in one stage, paged.
        if (filter.type) {
          const all = store.filter(
            (item) =>
              item.relationships.item_type.data.id === filter.type &&
              item.meta.stage === filter.fields?._stage.eq,
          );
          const { offset = 0, limit = all.length } = query.page ?? {};
          return {
            data: all.slice(offset, offset + limit),
            meta: { total_count: all.length },
          };
        }
        // The re-read of selected records by ID.
        const ids = new Set(filter.ids?.split(','));
        const data = store.filter((item) => ids.has(item.id));
        return { data, meta: { total_count: data.length } };
      },
    ),
    rawBulkPublish: vi.fn(
      bulk((item) => {
        item.meta.status = 'published';
      }),
    ),
    rawBulkUnpublish: vi.fn(
      bulk((item) => {
        item.meta.status = 'draft';
      }),
    ),
    rawBulkDestroy: vi.fn(
      bulk((item) => {
        store = store.filter((candidate) => candidate !== item);
      }),
    ),
    rawBulkMoveToStage: vi.fn(
      bulk((item, payload) => {
        item.meta.stage = payload.data.attributes?.stage ?? null;
      }),
    ),
  },
  uploads: {
    list: vi.fn(async ({ filter }: { filter: { ids: string } }) =>
      filter.ids.split(',').map((id) => ({
        id,
        is_image: true,
        url: `https://img.test/${id}.jpg`,
      })),
    ),
  },
};

vi.mock('../src/lib/cma', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/cma')>()),
  buildCmaClient: () => client,
}));

const parameters = {
  menuItems: [
    {
      workflowId: 'wf1',
      workflowName: 'Editorial',
      stageId: 'review',
      stageName: 'In review',
    },
  ],
};
const [menuItem] = readMenuItems(parameters);

const itemTypes = [
  buildItemType('m1', 'Article', {
    workflowId: 'wf1',
    imageFieldId: 'f-cover',
  }),
  buildItemType('m2', 'Author', { workflowId: 'wf1' }),
];
const fields = {
  m1: [
    buildField('f1', 'title'),
    buildField('f-cover', 'cover', { type: 'file', position: 2 }),
  ],
  m2: [buildField('f2', 'name')],
};

function record(
  id: string,
  modelId: string,
  attributes: Record<string, unknown>,
  meta: Partial<Item['meta']> = {},
): Item {
  const item = buildItem(id, attributes, meta);
  item.relationships.item_type.data.id = modelId;
  return item;
}

function seed() {
  store = [
    record(
      'r1',
      'm1',
      { title: 'Older article', cover: null },
      { updated_at: '2026-01-01T10:00:00Z', status: 'published' },
    ),
    record(
      'r2',
      'm1',
      { title: 'Newest article', cover: { upload_id: 'u2' } },
      { updated_at: '2026-03-01T10:00:00Z', status: 'updated' },
    ),
    record(
      'r3',
      'm2',
      { name: 'Jane Doe' },
      { updated_at: '2026-02-01T10:00:00Z' },
    ),
  ];
}

function renderPage(
  options: {
    environment?: string;
    canEditSchema?: boolean;
    permissions?: { positive?: PermissionRule[]; negative?: PermissionRule[] };
  } = {},
) {
  const ctx = buildPageCtx({ parameters, itemTypes, fields, ...options });
  render(<StagePage ctx={ctx} menuItem={menuItem} />);
  return ctx;
}

function rowTitles() {
  return screen
    .getAllByRole('link')
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
}

function selectRow(title: string) {
  const row = screen.getByText(title).closest('[role="row"]') as HTMLElement;
  return userEvent.click(within(row).getByRole('checkbox'));
}

describe('StagePage', () => {
  beforeEach(() => {
    seed();
    client.workflows.find.mockResolvedValue({
      id: 'wf1',
      name: 'Editorial',
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'In review' },
        { id: 'ready', name: 'Ready' },
      ],
    });
  });

  it('lists the stage’s records across models, newest first', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'In review' }),
    ).toBeInTheDocument();
    await screen.findByText('Newest article');
    expect(rowTitles()).toEqual([
      'Newest article',
      'Jane Doe',
      'Older article',
    ]);
    expect(screen.getByText('3 records')).toBeInTheDocument();
    expect(screen.getByText('Editorial workflow')).toBeInTheDocument();
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Last update/ }),
    ).toHaveAttribute('aria-sort', 'descending');
    // Pagination stays hidden while everything fits on one page.
    expect(
      screen.queryByRole('navigation', { name: 'Pagination' }),
    ).not.toBeInTheDocument();
  });

  it('shows an image only for records that have one', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await waitFor(() =>
      expect(document.querySelectorAll('img')).toHaveLength(1),
    );
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://img.test/u2.jpg?w=80&h=80&fit=crop&auto=format',
    );
  });

  it('opens a record in the editor, keeping the sandbox environment', async () => {
    const ctx = renderPage({ environment: 'staging' });

    await userEvent.click(await screen.findByText('Jane Doe'));

    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/environments/staging/editor/item_types/m2/items/r3/edit',
    );
  });

  it('filters by search and by status', async () => {
    renderPage();
    const search = await screen.findByRole('textbox', {
      name: 'Search records',
    });
    await screen.findByText('Newest article');

    await userEvent.type(search, 'jane');
    expect(rowTitles()).toEqual(['Jane Doe']);
    expect(screen.getByText('1 record')).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(
      screen.getByText('No records match the current filters.'),
    ).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.click(
      screen.getByRole('button', { name: 'Filter by publication status' }),
    );
    await userEvent.click(
      screen.getByText('Unpublished changes', { selector: 'button *, button' }),
    );
    expect(rowTitles()).toEqual(['Newest article']);
  });

  it('sorts by a column when its header is clicked', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(
      screen.getByRole('columnheader', { name: /Preview/ }),
    ).toHaveAttribute('aria-sort', 'ascending');
    expect(rowTitles()).toEqual([
      'Jane Doe',
      'Newest article',
      'Older article',
    ]);
  });

  it('paginates long stages', async () => {
    store = Array.from({ length: 60 }, (_, index) =>
      record(`r${index}`, 'm1', { title: `Article ${index}` }),
    );
    renderPage();
    await screen.findByText('60 records');

    expect(rowTitles()).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(rowTitles()).toHaveLength(10);
  });

  it('says when the stage is empty', async () => {
    store = [];
    renderPage();

    expect(
      await screen.findByText('No records in this stage.'),
    ).toBeInTheDocument();
  });

  it('explains a stage that was deleted', async () => {
    client.workflows.find.mockResolvedValue({
      id: 'wf1',
      name: 'Editorial',
      stages: [{ id: 'draft', name: 'Draft' }],
    });
    renderPage();

    expect(
      await screen.findByText('This stage no longer exists'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open plugin settings' }),
    ).toBeInTheDocument();
  });

  it('offers a retry when the records can’t be loaded', async () => {
    client.items.rawList.mockRejectedValueOnce(new Error('Network down'));
    renderPage();

    expect(
      await screen.findByText('Could not load records'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Newest article')).toBeInTheDocument();
  });

  it('handles a page that is no longer configured', () => {
    render(
      <StagePage
        ctx={buildPageCtx({ itemTypes, canEditSchema: false })}
        menuItem={null}
      />,
    );

    expect(
      screen.getByText('This page is no longer available'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open plugin settings' }),
    ).not.toBeInTheDocument();
  });
});

describe('selection and bulk actions', () => {
  beforeEach(() => {
    seed();
    vi.clearAllMocks();
    client.workflows.find.mockResolvedValue({
      id: 'wf1',
      name: 'Editorial',
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'In review' },
        { id: 'ready', name: 'Ready' },
      ],
    });
  });

  it('shows the selection bar once records are selected', async () => {
    renderPage();
    await screen.findByText('Newest article');
    expect(
      screen.queryByRole('region', { name: 'Selection actions' }),
    ).not.toBeInTheDocument();

    await selectRow('Newest article');
    await selectRow('Jane Doe');

    const bar = screen.getByRole('region', { name: 'Selection actions' });
    expect(within(bar).getByText('2 records selected')).toBeInTheDocument();
    for (const label of ['Delete', 'Publish', 'Unpublish', 'Move to stage']) {
      expect(within(bar).getByRole('button', { name: label })).toBeEnabled();
    }

    await userEvent.click(
      within(bar).getByRole('button', { name: 'Deselect all records' }),
    );
    expect(
      screen.queryByRole('region', { name: 'Selection actions' }),
    ).not.toBeInTheDocument();
  });

  it('publishes the selected records after confirming', async () => {
    const ctx = renderPage();
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Older article');

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(client.items.rawBulkPublish).toHaveBeenCalled());
    expect(ctx.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Publish selected records',
        content: '2 records will be affected.',
      }),
    );
    const sent = client.items.rawBulkPublish.mock.calls[0][0] as BulkPayload;
    expect(
      sent.data.relationships.items.data.map(({ id }) => id).sort(),
    ).toEqual(['r1', 'r2']);
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('2 records published.'),
    );
    // The page reloads, so the new status shows.
    await waitFor(() =>
      expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument(),
    );
  });

  it('moves records of different models with one request per model', async () => {
    const ctx = renderPage();
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Jane Doe');
    await selectRow('Older article');

    await userEvent.click(
      screen.getByRole('button', { name: 'Move to stage' }),
    );

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('3 records moved.'),
    );
    // The page's own stage isn't offered as a destination.
    expect(ctx.openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: {
          count: 3,
          stages: [
            { id: 'draft', name: 'Draft' },
            { id: 'ready', name: 'Ready' },
          ],
        },
      }),
    );
    const batches = client.items.rawBulkMoveToStage.mock.calls.map(
      ([payload]) =>
        (payload as BulkPayload).data.relationships.items.data
          .map(({ id }) => id)
          .sort(),
    );
    expect(batches).toEqual([['r1', 'r2'], ['r3']]);
    // Moved records leave the stage.
    expect(
      await screen.findByText('No records in this stage.'),
    ).toBeInTheDocument();
  });

  it('asks before deleting, and warns that it cannot be undone', async () => {
    const ctx = renderPage();
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(client.items.rawBulkDestroy).toHaveBeenCalled());
    expect(ctx.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete selected records',
        content: '1 record will be affected. This action cannot be undone.',
        choices: [{ label: 'Delete', value: true, intent: 'negative' }],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument(),
    );
  });

  it('offers only the actions the role allows', async () => {
    renderPage({
      permissions: { positive: [{ action: 'publish', on_creator: 'anyone' }] },
    });
    await screen.findByText('Newest article');
    await selectRow('Newest article');

    const bar = screen.getByRole('region', { name: 'Selection actions' });
    expect(within(bar).getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(
      within(bar).queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: 'Move to stage' }),
    ).not.toBeInTheDocument();
  });

  it('skips records that left the stage since they were selected', async () => {
    const ctx = renderPage();
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Jane Doe');
    // Someone else moves Jane Doe away before the action runs.
    const moved = store.find((item) => item.id === 'r3');
    if (moved) moved.meta.stage = 'ready';

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(client.items.rawBulkPublish).toHaveBeenCalled());
    const sent = client.items.rawBulkPublish.mock.calls[0][0] as BulkPayload;
    expect(sent.data.relationships.items.data).toEqual([
      { id: 'r2', type: 'item' },
    ]);
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('1 record published.'),
    );
  });

  it('selects every matching record across pages', async () => {
    store = Array.from({ length: 60 }, (_, index) =>
      record(`r${index}`, 'm1', { title: `Article ${index}` }),
    );
    renderPage();
    await screen.findByText('60 records');

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    );
    const bar = screen.getByRole('region', { name: 'Selection actions' });
    expect(within(bar).getByText('50 records selected')).toBeInTheDocument();

    await userEvent.click(
      within(bar).getByRole('button', { name: 'Select all matching records' }),
    );
    expect(within(bar).getByText('60 records selected')).toBeInTheDocument();

    await userEvent.click(
      within(bar).getByRole('button', { name: 'Show selection' }),
    );
    expect(
      within(bar).getByRole('button', { name: 'Hide selection' }),
    ).toBeInTheDocument();
  });
});

describe('review regressions', () => {
  beforeEach(() => {
    seed();
    vi.clearAllMocks();
    client.workflows.find.mockResolvedValue({
      id: 'wf1',
      name: 'Editorial',
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'In review' },
        { id: 'ready', name: 'Ready' },
      ],
    });
  });

  function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('leaves "Show selection" when the search changes', async () => {
    renderPage();
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Jane Doe');
    await userEvent.click(
      screen.getByRole('button', { name: 'Show selection' }),
    );
    expect(rowTitles()).toHaveLength(2);

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search records' }),
      'Older',
    );

    expect(rowTitles()).toEqual(['Older article']);
    expect(
      screen.getByRole('button', { name: 'Show selection' }),
    ).toBeInTheDocument();
  });

  it('replaces the selection with every matching record', async () => {
    store = [
      ...Array.from({ length: 60 }, (_, i) =>
        record(`p${i}`, 'm1', { title: `Post ${i}` }),
      ),
      record('a0', 'm2', { name: 'Author zero' }),
    ];
    renderPage();
    await screen.findByText('61 records');
    const search = screen.getByRole('textbox', { name: 'Search records' });

    await userEvent.type(search, 'Author zero');
    await selectRow('Author zero');
    await userEvent.clear(search);
    await userEvent.type(search, 'Post');
    await userEvent.click(
      screen.getByRole('button', { name: 'Select all matching records' }),
    );

    expect(screen.getByText('60 records selected')).toBeInTheDocument();
  });

  it('returns to the list page after hiding the selection', async () => {
    store = Array.from({ length: 60 }, (_, i) =>
      record(`r${i}`, 'm1', { title: `Article ${i}` }),
    );
    renderPage();
    await screen.findByText('60 records');
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await selectRow(rowTitles()[0] ?? '');

    await userEvent.click(
      screen.getByRole('button', { name: 'Show selection' }),
    );
    expect(rowTitles()).toHaveLength(1);
    await userEvent.click(
      screen.getByRole('button', { name: 'Hide selection' }),
    );

    expect(rowTitles()).toHaveLength(10);
  });

  it('does not offer a Status sort while filtering by status', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await userEvent.click(
      screen.getByRole('button', { name: 'Filter by publication status' }),
    );
    await userEvent.click(
      screen.getByText('Draft', { selector: 'button *, button' }),
    );

    const header = screen.getByRole('columnheader', { name: /Status/ });
    expect(
      within(header).queryByRole('button', { name: 'Status' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('columnheader', { name: /Model/ })).getByRole(
        'button',
        { name: 'Model' },
      ),
    ).toBeInTheDocument();
  });

  it('shows no record count until the stage has loaded', async () => {
    renderPage();
    expect(screen.queryByText('0 records')).not.toBeInTheDocument();
    expect(await screen.findByText('3 records')).toBeInTheDocument();
  });

  it('keeps the page-size selector after choosing a larger size', async () => {
    store = Array.from({ length: 60 }, (_, i) =>
      record(`r${i}`, 'm1', { title: `Article ${i}` }),
    );
    renderPage();
    await screen.findByText('60 records');

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Records per page' }),
      '100',
    );

    expect(rowTitles()).toHaveLength(60);
    expect(
      screen.getByRole('combobox', { name: 'Records per page' }),
    ).toBeInTheDocument();
  });

  it('shows progress and Cancel while a move runs one job per model', async () => {
    const firstJob = deferred<unknown>();
    const original = client.items.rawBulkMoveToStage.getMockImplementation();
    if (!original) throw new Error('Missing mock');
    client.items.rawBulkMoveToStage.mockImplementationOnce(async (payload) => {
      await firstJob.promise;
      return original(payload);
    });
    renderPage();
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Jane Doe');

    await userEvent.click(
      screen.getByRole('button', { name: 'Move to stage' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Cancel remaining' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 of 2 processed/)).toBeInTheDocument();
    firstJob.resolve(undefined);
    await waitFor(() =>
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument(),
    );
    expect(rowTitles()).toEqual(['Older article']);
  });

  it('asks nothing once the page is left mid-action', async () => {
    const read = deferred<unknown>();
    const original = client.items.rawList.getMockImplementation();
    if (!original) throw new Error('Missing mock');
    const ctx = buildPageCtx({ parameters, itemTypes, fields });
    const view = render(<StagePage ctx={ctx} menuItem={menuItem} />);
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');
    client.items.rawList.mockImplementationOnce(async (query) => {
      await read.promise;
      return original(query);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    view.unmount();
    read.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
  });
});

describe('second review round', () => {
  beforeEach(() => {
    seed();
    vi.clearAllMocks();
    client.workflows.find.mockResolvedValue({
      id: 'wf1',
      name: 'Editorial',
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'In review' },
        { id: 'ready', name: 'Ready' },
      ],
    });
  });

  async function pickStatus(label: string) {
    const trigger = screen.getByRole('button', {
      name: 'Filter by publication status',
    });
    await userEvent.click(trigger);
    // The trigger can show the same label; pick the menu option.
    const option = screen
      .getAllByText(label, { selector: 'button *, button' })
      .find((element) => !trigger.contains(element));
    if (!option) throw new Error(`No "${label}" option`);
    await userEvent.click(option);
  }

  it('drops a Status sort when filtering by status, for good', async () => {
    renderPage();
    await screen.findByText('Newest article');
    await userEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(
      screen.getByRole('columnheader', { name: /Status/ }),
    ).toHaveAttribute('aria-sort', 'ascending');

    await pickStatus('Draft');
    await pickStatus('All statuses');

    expect(
      screen.getByRole('columnheader', { name: /Last update/ }),
    ).toHaveAttribute('aria-sort', 'descending');
    expect(
      screen.getByRole('columnheader', { name: /Status/ }),
    ).toHaveAttribute('aria-sort', 'none');
  });

  it('does not offer a Model sort while filtering by model', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await userEvent.click(
      screen.getByRole('button', { name: 'Filter by model' }),
    );
    await userEvent.click(
      screen.getByText('Author', { selector: 'button *, button' }),
    );

    expect(
      within(screen.getByRole('columnheader', { name: /Model/ })).queryByRole(
        'button',
        { name: 'Model' },
      ),
    ).not.toBeInTheDocument();
  });

  it('keeps the selection view when the active filter is picked again', async () => {
    renderPage();
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');
    await userEvent.click(
      screen.getByRole('button', { name: 'Show selection' }),
    );

    await pickStatus('All statuses');

    expect(
      screen.getByRole('button', { name: 'Hide selection' }),
    ).toBeInTheDocument();
    expect(rowTitles()).toEqual(['Jane Doe']);
  });

  it('offers Move without known stages only to roles that may move', async () => {
    client.workflows.find.mockRejectedValueOnce(new Error('Network down'));
    const view = render(
      <StagePage
        ctx={buildPageCtx({ parameters, itemTypes, fields })}
        menuItem={menuItem}
      />,
    );
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');
    expect(
      screen.getByRole('button', { name: 'Move to stage' }),
    ).toBeInTheDocument();
    view.unmount();

    client.workflows.find.mockRejectedValueOnce(new Error('Network down'));
    renderPage({
      permissions: { positive: [{ action: 'publish', on_creator: 'anyone' }] },
    });
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');
    expect(
      screen.queryByRole('button', { name: 'Move to stage' }),
    ).not.toBeInTheDocument();
  });
});
