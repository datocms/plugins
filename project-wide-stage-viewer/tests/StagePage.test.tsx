import type { RawApiTypes } from '@datocms/cma-client-browser';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
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

// Each row checkbox is named by the first cell of its row: the title
function rowCheckboxes(): HTMLElement[] {
  return screen
    .queryAllByRole('checkbox')
    .filter((box) => box.hasAttribute('aria-labelledby'));
}

function rowTitles(): string[] {
  return rowCheckboxes().map(
    (box) =>
      document.getElementById(box.getAttribute('aria-labelledby') ?? '')
        ?.textContent ?? '',
  );
}

function selectRow(title: string) {
  return userEvent.click(screen.getByRole('checkbox', { name: title }));
}

// The search row opens with the magnifier of the title bar
async function search(text: string) {
  if (!screen.queryByRole('search', { name: 'Records' })) {
    await userEvent.click(
      screen.getByRole('button', { name: 'Filter Records' }),
    );
  }
  const input = within(
    screen.getByRole('search', { name: 'Records' }),
  ).getByRole('textbox');
  await userEvent.clear(input);
  if (text) await userEvent.paste(text);
}

// The menus of the kit open, and pick, on mouse down
async function openMenu(trigger: string) {
  fireEvent.mouseDown(screen.getByRole('button', { name: trigger }));
}

// The pick closes the menu, which leaves the page after its transition
async function pick(option: string) {
  fireEvent.mouseDown(await screen.findByRole('menuitem', { name: option }));
  await waitFor(() =>
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument(),
  );
}

// A filter trigger is named by its current value
async function filterBy(current: string, option: string) {
  await openMenu(current);
  await pick(option);
}

// The sortable headers are buttons named by their label
function sortHeader(label: string) {
  return screen.queryByRole('button', { name: label });
}

// The bar slides out: it leaves the page once its transition ends
async function expectNoSelectionBar() {
  await waitFor(() =>
    expect(screen.queryByText(/records? selected$/)).not.toBeInTheDocument(),
  );
}

const STAGES = {
  id: 'wf1',
  name: 'Editorial',
  stages: [
    { id: 'draft', name: 'Draft' },
    { id: 'review', name: 'In review' },
    { id: 'ready', name: 'Ready' },
  ],
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function manyArticles(count: number, prefix = 'Article') {
  return Array.from({ length: count }, (_, index) =>
    record(`r${index}`, 'm1', { title: `${prefix} ${index}` }),
  );
}

beforeEach(() => {
  seed();
  vi.clearAllMocks();
  client.workflows.find.mockResolvedValue(STAGES);
});

describe('StagePage', () => {
  it('lists the stage’s records across models, newest first', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'In review' }),
    ).toBeInTheDocument();
    await screen.findByText('Newest article');
    expect(rowTitles()).toEqual([
      'Newest article',
      'Jane Doe',
      'Older article',
    ]);
    expect(screen.getByText('3 records')).toBeInTheDocument();
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
    // The help of the title names the stage and its workflow
    await userEvent.click(
      screen.getByRole('button', { name: 'About this page' }),
    );
    expect(
      await screen.findByText(/In review stage of the Editorial workflow/),
    ).toBeInTheDocument();
    // Pagination stays hidden while everything fits on one page.
    expect(
      screen.queryByRole('button', { name: 'Go to page 1' }),
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
    await screen.findByText('Newest article');

    await search('jane');
    expect(rowTitles()).toEqual(['Jane Doe']);
    expect(screen.getByText('1 record')).toBeInTheDocument();

    await search('zzz');
    expect(screen.getByText('Nothing matches the filter.')).toBeInTheDocument();
    expect(screen.getByText('0 records')).toBeInTheDocument();

    await search('');
    await filterBy('All statuses', 'Unpublished changes');
    expect(rowTitles()).toEqual(['Newest article']);
  });

  it('clears the search with Escape', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await search('jane');
    expect(rowTitles()).toEqual(['Jane Doe']);

    await userEvent.keyboard('{Escape}');
    expect(rowTitles()).toHaveLength(3);
    expect(
      screen.queryByRole('search', { name: 'Records' }),
    ).not.toBeInTheDocument();
  });

  it('sorts by a column when its header is clicked', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await userEvent.click(sortHeader('Title') as HTMLElement);

    expect(rowTitles()).toEqual([
      'Jane Doe',
      'Newest article',
      'Older article',
    ]);
  });

  it('paginates long stages', async () => {
    store = manyArticles(60);
    renderPage();
    await screen.findByText('60 records');

    expect(rowTitles()).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(rowTitles()).toHaveLength(10);
  });

  it('says when the stage is empty', async () => {
    store = [];
    renderPage();

    expect(
      await screen.findByText(/Records show here when they move to this stage/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'In review' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('explains a stage that was deleted', async () => {
    client.workflows.find.mockResolvedValue({
      ...STAGES,
      stages: [{ id: 'draft', name: 'Draft' }],
    });
    renderPage();

    expect(
      await screen.findByRole('heading', {
        name: 'This stage no longer exists',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open plugin settings' }),
    ).toHaveAttribute('href', '/configuration/plugins/plugin-1/edit');
    // Reloading can't bring the stage back
    expect(
      screen.queryByRole('button', { name: 'Reload' }),
    ).not.toBeInTheDocument();
  });

  it('asks an editor to have an administrator remove a deleted stage', async () => {
    client.workflows.find.mockResolvedValue({
      ...STAGES,
      stages: [{ id: 'draft', name: 'Draft' }],
    });
    renderPage({ canEditSchema: false });

    expect(
      await screen.findByText(/Ask an administrator to remove this page/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open plugin settings' }),
    ).not.toBeInTheDocument();
  });

  it('tells an editor that an administrator assigns the workflow to a model', async () => {
    const ctx = buildPageCtx({
      parameters,
      itemTypes: [],
      fields,
      canEditSchema: false,
    });
    render(<StagePage ctx={ctx} menuItem={menuItem} />);

    expect(
      await screen.findByText(
        'Records in the In review stage show here once an administrator assigns the Editorial workflow to a model.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('offers a retry when the records can’t be loaded', async () => {
    client.items.rawList.mockRejectedValueOnce(
      new TypeError('Failed to fetch'),
    );
    renderPage();

    expect(
      await screen.findByText("Couldn't load the records"),
    ).toBeInTheDocument();
    // A failed connection shows the advice alone, not the browser's message
    expect(
      screen.getByText('Check your connection, then try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    // The title bar stays
    expect(
      screen.getByRole('heading', { level: 1, name: 'In review' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
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
      screen.getByRole('heading', { name: 'This page is no longer available' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open plugin settings' }),
    ).not.toBeInTheDocument();
  });

  it('asks for the API token permission without calling the API', () => {
    const ctx = {
      ...buildPageCtx({ parameters, itemTypes, fields }),
      currentUserAccessToken: undefined,
    } as unknown as RenderPageCtx;
    render(<StagePage ctx={ctx} menuItem={menuItem} />);

    expect(
      screen.getByRole('heading', { name: 'This page needs a permission' }),
    ).toBeInTheDocument();
    expect(client.items.rawList).not.toHaveBeenCalled();
  });
});

describe('selection and bulk actions', () => {
  it('shows the selection bar once records are selected', async () => {
    renderPage();
    await screen.findByText('Newest article');
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();

    await selectRow('Newest article');
    await selectRow('Jane Doe');

    expect(screen.getByText('2 records selected')).toBeInTheDocument();
    for (const label of ['Delete', 'Publish', 'Unpublish', 'Move to stage']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    }

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear selection' }),
    );
    await expectNoSelectionBar();
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
        title: 'Publish 2 records?',
        content: 'Their latest changes go live.',
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

    await openMenu('Move to stage');
    await screen.findByRole('menuitem', { name: 'Draft' });
    // The page's own stage isn't offered as a destination.
    expect(
      screen.getAllByRole('menuitem').map((option) => option.textContent),
    ).toEqual(['Draft', 'Ready']);
    await pick('Draft');

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('3 records moved to Draft.'),
    );
    // Every selected record can move, and a move is easy to undo: no question
    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(ctx.openModal).not.toHaveBeenCalled();
    const batches = client.items.rawBulkMoveToStage.mock.calls.map(
      ([payload]) =>
        (payload as BulkPayload).data.relationships.items.data
          .map(({ id }) => id)
          .sort(),
    );
    expect(batches).toEqual([['r1', 'r2'], ['r3']]);
    // Moved records leave the stage.
    expect(
      await screen.findByText(/Records show here when they move to this stage/),
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
        title: 'Delete the record?',
        content: "You can't undo this.",
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

    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Move to stage' }),
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

  it('says what was not done when the selection left the stage', async () => {
    const ctx = renderPage();
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');
    const moved = store.find((item) => item.id === 'r3');
    if (moved) moved.meta.stage = 'ready';

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith(
        "The record wasn't published: it's no longer in this stage.",
      ),
    );
    expect(client.items.rawBulkPublish).not.toHaveBeenCalled();
  });

  it('counts the records that a partial selection acts on', async () => {
    const ctx = renderPage({
      permissions: {
        positive: [
          { action: 'publish', item_type: 'm1', on_creator: 'anyone' },
        ],
      },
    });
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Jane Doe');

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(client.items.rawBulkPublish).toHaveBeenCalled());
    expect(ctx.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Publish 1 record?',
        content:
          'Only 1 of the 2 selected records can be published. The other stays as it is.',
      }),
    );
  });

  it('selects every matching record across pages', async () => {
    store = manyArticles(60);
    renderPage();
    await screen.findByText('60 records');

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    );
    expect(screen.getByText('50 records selected')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Select all 60 records' }),
    );
    expect(screen.getByText('60 records selected')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show selection' }),
    );
    expect(
      screen.getByRole('button', { name: 'Hide selection' }),
    ).toBeInTheDocument();
  });
});

describe('review regressions', () => {
  it('leaves "Show selection" when the search changes', async () => {
    renderPage();
    await screen.findByText('Newest article');
    await selectRow('Newest article');
    await selectRow('Jane Doe');
    await userEvent.click(
      screen.getByRole('button', { name: 'Show selection' }),
    );
    expect(rowTitles()).toHaveLength(2);

    await search('Older');

    expect(rowTitles()).toEqual(['Older article']);
    expect(
      screen.getByRole('button', { name: 'Show selection' }),
    ).toBeInTheDocument();
  });

  it('replaces the selection with every matching record', async () => {
    store = [
      ...manyArticles(60, 'Post'),
      record('a0', 'm2', { name: 'Author zero' }),
    ];
    renderPage();
    await screen.findByText('61 records');

    await search('Author zero');
    await selectRow('Author zero');
    await search('Post');
    await userEvent.click(
      screen.getByRole('button', { name: 'Select all 60 matching records' }),
    );

    expect(screen.getByText('60 records selected')).toBeInTheDocument();
  });

  it('returns to the list page after hiding the selection', async () => {
    store = manyArticles(60);
    renderPage();
    await screen.findByText('60 records');
    await userEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
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
    expect(sortHeader('Status')).toBeInTheDocument();

    await filterBy('All statuses', 'Draft');

    expect(sortHeader('Status')).not.toBeInTheDocument();
    expect(sortHeader('Model')).toBeInTheDocument();
  });

  it('shows no record count until the stage has loaded', async () => {
    renderPage();
    expect(screen.queryByText('0 records')).not.toBeInTheDocument();
    expect(await screen.findByText('3 records')).toBeInTheDocument();
  });

  it('keeps the page-size selector after choosing a larger size', async () => {
    store = manyArticles(60);
    renderPage();
    await screen.findByText('60 records');

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Items per page' }),
      '100',
    );

    expect(rowTitles()).toHaveLength(60);
    expect(
      screen.getByRole('combobox', { name: 'Items per page' }),
    ).toBeInTheDocument();
  });

  it('runs a move one job per model while the other actions wait', async () => {
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

    await openMenu('Move to stage');
    await pick('Ready');

    // The other actions wait, and say why
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publish' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    // Two records split by model need no progress
    expect(
      screen.queryByRole('button', { name: 'Stop' }),
    ).not.toBeInTheDocument();
    firstJob.resolve(undefined);
    await waitFor(() =>
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument(),
    );
    expect(rowTitles()).toEqual(['Older article']);
  });

  it('shows the progress and Stop while more records than one job run', async () => {
    store = manyArticles(250);
    const firstJob = deferred<unknown>();
    const original = client.items.rawBulkPublish.getMockImplementation();
    if (!original) throw new Error('Missing mock');
    client.items.rawBulkPublish.mockImplementationOnce(async (payload) => {
      await firstJob.promise;
      return original(payload);
    });
    const ctx = renderPage();
    await screen.findByText('250 records');
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Select all 250 records' }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByRole('button', { name: 'Stop' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Publishing 250 records…')).toBeInTheDocument();
    firstJob.resolve(undefined);
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('250 records published.'),
    );
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
  it('drops a Status sort when filtering by status, for good', async () => {
    renderPage();
    await screen.findByText('Newest article');
    await userEvent.click(sortHeader('Status') as HTMLElement);
    // Draft, then Published, then Unpublished changes
    expect(rowTitles()).toEqual([
      'Jane Doe',
      'Older article',
      'Newest article',
    ]);

    await filterBy('All statuses', 'Draft');
    await filterBy('Draft', 'All statuses');

    // Back to the default order: the most recent update first
    expect(rowTitles()).toEqual([
      'Newest article',
      'Jane Doe',
      'Older article',
    ]);
  });

  it('does not offer a Model sort while filtering by model', async () => {
    renderPage();
    await screen.findByText('Newest article');

    await filterBy('All models', 'Author');

    expect(sortHeader('Model')).not.toBeInTheDocument();
    expect(rowTitles()).toEqual(['Jane Doe']);
  });

  it('keeps the selection view when the active filter is picked again', async () => {
    renderPage();
    await screen.findByText('Newest article');
    await selectRow('Jane Doe');
    await userEvent.click(
      screen.getByRole('button', { name: 'Show selection' }),
    );

    await filterBy('All statuses', 'All statuses');

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
