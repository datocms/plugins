// @vitest-environment node

import { createHash } from 'node:crypto';
import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js';
import { MemoryWorkspace } from '../test/memoryWorkspace';
import {
  exportProjectDump,
  IncompleteAccessError,
  JsonLines,
} from './projectDump';

type Resource = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
  meta?: Record<string, unknown>;
};

const fixture = vi.hoisted(() => ({
  client: undefined as unknown,
  workspace: undefined as unknown,
}));

vi.mock('@datocms/cma-client-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datocms/cma-client-browser')>()),
  buildClient: vi.fn(() => fixture.client),
}));

vi.mock('./exportWorkspace', () => ({
  ExportWorkspace: { open: vi.fn(async () => fixture.workspace) },
}));

const assetBytes = new TextEncoder().encode('original bytes');
const md5 = createHash('md5').update(assetBytes).digest('hex');

function item(
  id: string,
  model: string,
  title: string,
  published: boolean,
): Resource {
  return {
    id,
    type: 'item',
    attributes: { title },
    relationships: { item_type: { data: { id: model, type: 'item_type' } } },
    meta: {
      published_at: published ? '2026-01-01T00:00:00Z' : null,
      publication_scheduled_at: null,
    },
  };
}

function model(id: string, apiKey: string, block = false): Resource {
  return {
    id,
    type: 'item_type',
    attributes: { api_key: apiKey, modular_block: block },
    relationships: { workflow: { data: null } },
  };
}

function field(id: string, modelId: string, fieldType: string): Resource {
  return {
    id,
    type: 'field',
    attributes: { field_type: fieldType },
    relationships: { item_type: { data: { id: modelId, type: 'item_type' } } },
  };
}

function createClient(
  options: {
    actor?: Record<string, unknown>;
    role?: Record<string, unknown>;
    totals?: (modelId: string) => number | undefined;
  } = {},
) {
  const current: Record<string, Resource[]> = {
    article: [
      item('a1', 'article', 'Current title', true),
      item('a2', 'article', 'Draft', false),
    ],
    tag: [item('t1', 'tag', 'Tag', true)],
  };
  const published = new Map<string, Resource>([
    ['a1', item('a1', 'article', 'Published title', true)],
    ['t1', item('t1', 'tag', 'Tag', true)],
  ]);
  const uploads = [
    {
      id: 'u1',
      url: 'https://www.datocms-assets.com/1/photo.jpg',
      filename: 'photo.jpg',
      md5,
      size: assetBytes.byteLength,
      upload_collection: null,
    },
  ];
  const request = vi.fn(async ({ queryParams }: { queryParams: unknown }) => {
    const query = queryParams as {
      filter: { type?: string; ids?: string };
      page: { offset?: number; limit: number };
      version?: string;
    };
    if (query.filter.ids) {
      return {
        data: query.filter.ids
          .split(',')
          .flatMap((id) => published.get(id) ?? []),
        meta: { total_count: 0 },
      };
    }
    const records = current[query.filter.type ?? ''] ?? [];
    const offset = query.page.offset ?? 0;
    return {
      data: records.slice(offset, offset + query.page.limit),
      meta: {
        total_count:
          options.totals?.(query.filter.type ?? '') ?? records.length,
      },
    };
  });
  return {
    request,
    site: {
      rawFind: vi.fn(async () => ({
        data: {
          id: 'site-1',
          type: 'site',
          attributes: { locales: ['en', 'it'] },
        },
        included: [
          model('article', 'article'),
          model('tag', 'tag'),
          model('hero', 'hero', true),
          field('body', 'article', 'structured_text'),
          field('label', 'tag', 'string'),
        ],
      })),
    },
    workflows: { list: vi.fn(async () => []) },
    users: {
      findMe: vi.fn(async () => options.actor ?? { type: 'account' }),
    },
    roles: { find: vi.fn(async () => options.role ?? {}) },
    uploads: {
      list: vi.fn(async ({ page }: { page: { offset: number } }) =>
        uploads.slice(page.offset),
      ),
      rawList: vi.fn(async () => ({ meta: { total_count: uploads.length } })),
    },
    uploadCollections: {
      list: vi.fn(async () => [{ id: 'c1', label: 'Photos' }]),
    },
  };
}

async function readZip(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const text = async (name: string) => {
    const entry = entries.find((candidate) => candidate.filename === name);
    if (!entry || entry.directory) throw new Error(`No entry ${name}`);
    return entry.getData(new TextWriter());
  };
  const bytes = async (name: string) => {
    const entry = entries.find((candidate) => candidate.filename === name);
    if (!entry || entry.directory) throw new Error(`No entry ${name}`);
    return entry.getData(new Uint8ArrayWriter());
  };
  const lines = async (name: string) =>
    (await text(name))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return {
    names: entries.map((entry) => entry.filename),
    text,
    bytes,
    lines,
  };
}

let workspace: MemoryWorkspace;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  workspace = new MemoryWorkspace();
  fixture.workspace = workspace;
  fixture.client = createClient();
  fetchMock = vi.fn(async () => new Response(assetBytes));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const exportArgs = {
  apiToken: 'token',
  environment: 'main',
  primary: true,
  includeAssets: true,
};

test('writes the content:export dump layout and downloads it once', async () => {
  const { filename, manifest } = await exportProjectDump(exportArgs);

  expect(filename).toMatch(/^\d+_main\.dump-records-assets\.zip$/);
  expect(workspace.downloads.map((download) => download.name)).toEqual([
    filename,
  ]);
  const zip = await readZip(workspace.downloads[0].blob);
  expect(zip.names).toEqual([
    'schema.json',
    'records/000001.jsonl',
    'uploads/000001.jsonl',
    'upload-collections/000001.jsonl',
    'assets/u1/photo.jpg',
    'manifest.json',
  ]);
  expect(JSON.parse(await zip.text('manifest.json'))).toEqual({
    format: 'datocms-project-dump',
    version: 1,
    createdAt: manifest.createdAt,
    pluginVersion: manifest.pluginVersion,
    site: { id: 'site-1', environment: 'main', primary: true },
    locales: ['en', 'it'],
    includesAssets: true,
    counts: { records: 3, uploads: 1, uploadCollections: 1 },
  });
  const schema = JSON.parse(await zip.text('schema.json'));
  expect(schema.site.data.id).toBe('site-1');
  expect(schema.workflows).toEqual([]);
});

test('keeps each record as the CMA returns it, with its published version', async () => {
  await exportProjectDump(exportArgs);
  const zip = await readZip(workspace.downloads[0].blob);
  const lines = await zip.lines('records/000001.jsonl');

  expect(lines.map((line) => line.id)).toEqual(['a1', 'a2', 't1']);
  expect(lines[0]).toEqual({
    id: 'a1',
    current: item('a1', 'article', 'Current title', true),
    published: item('a1', 'article', 'Published title', true),
  });
  expect(lines[1].published).toBeNull();
  const client = fixture.client as ReturnType<typeof createClient>;
  const queries = client.request.mock.calls.map(
    ([{ queryParams }]) => queryParams as Record<string, unknown>,
  );
  // Only models with block fields are read nested, as content:export does.
  expect(queries).toContainEqual(
    expect.objectContaining({
      filter: { type: 'article' },
      nested: true,
      version: 'current',
    }),
  );
  expect(queries).toContainEqual(
    expect.objectContaining({
      filter: { type: 'tag' },
      nested: false,
      version: 'current',
    }),
  );
  expect(
    queries.some(
      (query) => (query.filter as { type?: string }).type === 'hero',
    ),
  ).toBe(false);
});

test('stores uploads, folders and original asset files', async () => {
  await exportProjectDump(exportArgs);
  const zip = await readZip(workspace.downloads[0].blob);

  expect(await zip.lines('uploads/000001.jsonl')).toEqual([
    expect.objectContaining({ id: 'u1', filename: 'photo.jpg', md5 }),
  ]);
  expect(await zip.lines('upload-collections/000001.jsonl')).toEqual([
    { id: 'c1', label: 'Photos' },
  ]);
  expect(await zip.bytes('assets/u1/photo.jpg')).toEqual(assetBytes);
  const url = new URL(fetchMock.mock.calls[0][0] as string);
  expect(url.searchParams.get('skip-default-optimizations')).toBe('true');
  expect(url.searchParams.get('svg-sanitize')).toBe('false');
});

test('leaves asset files out unless asked', async () => {
  const { filename } = await exportProjectDump({
    ...exportArgs,
    includeAssets: false,
  });

  expect(filename).toMatch(/\.dump-records\.zip$/);
  const zip = await readZip(workspace.downloads[0].blob);
  expect(zip.names.some((name) => name.startsWith('assets/'))).toBe(false);
  expect(JSON.parse(await zip.text('manifest.json')).includesAssets).toBe(
    false,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test('stops without downloading when content changes while it is read', async () => {
  // The listing promises three articles but returns two.
  fixture.client = createClient({
    totals: (modelId) => (modelId === 'article' ? 3 : undefined),
  });

  await expect(exportProjectDump(exportArgs)).rejects.toThrow(
    'Content changed while it was being read.',
  );
  expect(workspace.downloads).toEqual([]);
  expect(workspace.clears).toBe(1);
});

test('refuses a role that cannot read everything before writing anything', async () => {
  fixture.client = createClient({
    actor: { type: 'user', role: { id: 'editor' } },
    role: {
      meta: {
        final_permissions: {
          positive_item_type_permissions: [
            {
              action: 'all',
              environment: 'main',
              on_creator: 'anyone',
              item_type: 'article',
            },
          ],
          negative_item_type_permissions: [],
          positive_upload_permissions: [],
          negative_upload_permissions: [],
        },
      },
    },
  });

  await expect(exportProjectDump(exportArgs)).rejects.toThrow(
    new IncompleteAccessError('every record of the tag model'),
  );
  expect(workspace.files.size).toBe(0);
  expect(workspace.downloads).toEqual([]);
});

test('fails when an asset file does not match its MD5', async () => {
  fetchMock.mockImplementation(
    async () => new Response(new TextEncoder().encode('changed bytes!')),
  );

  await expect(exportProjectDump(exportArgs)).rejects.toThrow(
    'Asset u1 could not be downloaded: Asset content does not match its MD5 checksum',
  );
  expect(workspace.downloads).toEqual([]);
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('splits JSON lines into numbered entries at the entry size', async () => {
  const output = new MemoryWorkspace();
  const zip = await output.zip('lines.zip');
  // Each line is 31 bytes, so two fit in 70.
  const lines = new JsonLines(zip, 'records', 70);
  for (const id of ['a', 'b', 'c']) {
    // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order.
    await lines.write({ id, text: 'x'.repeat(10) });
  }
  await lines.end();
  await zip.close();

  const read = await readZip(await output.file('lines.zip'));
  expect(read.names).toEqual(['records/000001.jsonl', 'records/000002.jsonl']);
  expect(
    (await read.lines('records/000001.jsonl')).map((line) => line.id),
  ).toEqual(['a', 'b']);
  expect(lines.count).toBe(3);
});

test('fails when a record is unpublished between its two reads', async () => {
  const client = createClient();
  const read = client.request.getMockImplementation();
  if (!read) throw new Error('Missing request fixture');
  client.request.mockImplementation(async (args) =>
    (args.queryParams as { filter: { ids?: string } }).filter.ids
      ? { data: [], meta: { total_count: 0 } }
      : read(args),
  );
  fixture.client = client;

  await expect(exportProjectDump(exportArgs)).rejects.toThrow(
    'Record a1 was published or unpublished while it was being read.',
  );
  expect(workspace.downloads).toEqual([]);
});

test('fails when assets change while they are read', async () => {
  const client = createClient();
  client.uploads.rawList
    .mockResolvedValueOnce({ meta: { total_count: 1 } })
    .mockResolvedValue({ meta: { total_count: 2 } });
  fixture.client = client;

  await expect(exportProjectDump(exportArgs)).rejects.toThrow(
    'Assets changed while they were being read.',
  );
  expect(workspace.downloads).toEqual([]);
  expect(workspace.clears).toBe(1);
});

test('downloads nothing when cancelled', async () => {
  const controller = new AbortController();
  const client = createClient();
  const read = client.request.getMockImplementation();
  if (!read) throw new Error('Missing request fixture');
  client.request.mockImplementation(async (args) => {
    controller.abort();
    return read(args);
  });
  fixture.client = client;

  await expect(
    exportProjectDump({ ...exportArgs, signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(workspace.downloads).toEqual([]);
  expect(workspace.clears).toBe(1);
});
