// @vitest-environment node
import { createHash } from 'node:crypto';
import type { Client } from '@datocms/cma-client-browser';
import {
  BlobReader,
  configure,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import downloadProjectDump, {
  type DumpManifest,
  writeProjectDump,
} from './projectDump';

const mocks = vi.hoisted(() => ({
  buildClient: vi.fn(),
  downloadBlob: vi.fn<(blob: Blob, filename: string) => Promise<void>>(),
}));

vi.mock('@datocms/cma-client-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datocms/cma-client-browser')>()),
  buildClient: mocks.buildClient,
}));

vi.mock('./exportRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exportRuntime')>()),
  downloadBlob: mocks.downloadBlob,
}));

type Row = {
  id: string;
  type: 'item';
  attributes: Record<string, unknown>;
  relationships: { item_type: { data: { id: string; type: 'item_type' } } };
  meta: Record<string, string | null>;
};
type Query = {
  filter: { type?: string; ids?: string };
  nested?: boolean;
  version?: string;
  page: { offset?: number; limit: number };
};

function row(id: string, model: string, meta: Partial<Row['meta']> = {}): Row {
  return {
    id,
    type: 'item',
    attributes: { title: `Record ${id}` },
    relationships: { item_type: { data: { id: model, type: 'item_type' } } },
    meta: {
      published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      ...meta,
    },
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const md5 = (data: Uint8Array) => createHash('md5').update(data).digest('hex');
const files: Record<string, Uint8Array<ArrayBuffer>> = {
  'upload-1': bytes('first file'),
  'upload-2': bytes('second file'),
};

function fakeProject() {
  const records = [
    row('a1', 'article', { published_at: '2026-01-01T00:00:00Z' }),
    row('a2', 'article'),
    row('a3', 'article', {
      published_at: '2026-01-01T00:00:00Z',
      publication_scheduled_at: '2030-01-01T00:00:00Z',
    }),
    row('p1', 'person', { published_at: '2026-01-01T00:00:00Z' }),
  ];
  const uploads = Object.entries(files).map(([id, data]) => ({
    id,
    filename: `${id}.txt`,
    url: `https://www.datocms-assets.com/1/${id}.txt`,
    md5: md5(data).toUpperCase(),
    size: data.byteLength,
    upload_collection: { id: 'folder-1', type: 'upload_collection' },
  }));
  const project = {
    records,
    uploads,
    actor: { type: 'account' } as Record<string, unknown>,
    queries: [] as Query[],
    /** Leaves records out of the published read, as if unpublished meanwhile. */
    unpublished: new Set<string>(),
    uploadTotal: undefined as number | undefined,
  };
  const field = (id: string, model: string, fieldType: string) => ({
    id,
    type: 'field',
    attributes: { api_key: id, field_type: fieldType },
    relationships: { item_type: { data: { id: model, type: 'item_type' } } },
  });
  const model = (id: string, block = false) => ({
    id,
    type: 'item_type',
    attributes: { api_key: id, modular_block: block },
    relationships: { workflow: { data: null } },
  });
  const client = {
    site: {
      rawFind: async () => ({
        data: {
          id: 'site-1',
          type: 'site',
          attributes: { locales: ['en', 'it'] },
        },
        included: [
          model('article'),
          model('person'),
          model('section', true),
          field('body', 'article', 'structured_text'),
          field('name', 'person', 'string'),
        ],
      }),
    },
    workflows: { list: async () => [] },
    users: { findMe: async () => project.actor },
    roles: { find: async () => null },
    request: async ({ queryParams }: { queryParams: Query }) => {
      project.queries.push(structuredClone(queryParams));
      const { filter, page } = queryParams;
      const matches = filter.ids
        ? project.records.filter(
            (record) =>
              filter.ids?.split(',').includes(record.id) &&
              record.meta.published_at &&
              !project.unpublished.has(record.id),
          )
        : project.records.filter(
            (record) => record.relationships.item_type.data.id === filter.type,
          );
      const offset = page.offset ?? 0;
      return {
        data: matches
          .slice(offset, offset + page.limit)
          .map((record) =>
            queryParams.version === 'published'
              ? { ...record, attributes: { title: 'Published' } }
              : record,
          ),
        meta: { total_count: matches.length },
      };
    },
    items: {
      rawCurrentVsPublishedState: async (id: string) => ({
        data: {
          relationships: {
            scheduled_publication: { data: { id: `schedule-${id}` } },
            scheduled_unpublishing: { data: null },
          },
        },
        included: [
          {
            id: `schedule-${id}`,
            type: 'scheduled_publication',
            attributes: { publication_scheduled_at: '2030-01-01T00:00:00Z' },
          },
        ],
      }),
    },
    uploads: {
      rawList: async () => ({
        data: [],
        meta: { total_count: project.uploadTotal ?? project.uploads.length },
      }),
      list: async ({ page }: { page: { offset: number; limit: number } }) =>
        project.uploads.slice(page.offset, page.offset + page.limit),
    },
    uploadCollections: {
      list: async () => [
        { id: 'folder-1', label: 'Folder', parent: null, position: 1 },
      ],
    },
  };
  return { project, client: client as unknown as Client };
}

async function readZip(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const text = async (name: string) => {
    const entry = entries.find((candidate) => candidate.filename === name);
    if (!entry || entry.directory) throw new Error(`No entry ${name}`);
    return entry.getData(new TextWriter());
  };
  const lines = async (prefix: string) => {
    const texts = await Promise.all(
      entries
        .filter((entry) => entry.filename.startsWith(`${prefix}/`))
        .map((entry) => text(entry.filename)),
    );
    return texts.flatMap((content) =>
      content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
  };
  const data = async (name: string) => {
    const entry = entries.find((candidate) => candidate.filename === name);
    if (!entry || entry.directory) throw new Error(`No entry ${name}`);
    return entry.getData(new Uint8ArrayWriter());
  };
  return {
    names: entries.map((entry) => entry.filename),
    manifest: JSON.parse(await text('manifest.json')) as DumpManifest,
    text,
    lines,
    data,
  };
}

const fetchMock = vi.fn(async (url: string) => {
  const id = new URL(url).pathname.split('/').pop()?.replace('.txt', '');
  const data = id && files[id];
  return data ? new Response(data) : new Response(null, { status: 404 });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('writeProjectDump', () => {
  test('writes the schema, records, uploads, folders and manifest of a CLI dump', async () => {
    const { client } = fakeProject();
    const { blob, manifest } = await writeProjectDump({
      client,
      environment: 'main',
      primary: true,
      includeAssets: false,
    });
    const zip = await readZip(blob);

    expect(zip.names).toEqual([
      'schema.json',
      'records/000001.jsonl',
      'uploads/000001.jsonl',
      'upload-collections/000001.jsonl',
      'manifest.json',
    ]);
    expect(zip.manifest).toEqual(manifest);
    expect(manifest).toMatchObject({
      format: 'datocms-project-dump',
      version: 1,
      site: { id: 'site-1', environment: 'main', primary: true },
      locales: ['en', 'it'],
      includesAssets: false,
      counts: { records: 4, uploads: 2, uploadCollections: 1 },
    });
    const schema = JSON.parse(await zip.text('schema.json'));
    expect(Object.keys(schema)).toEqual(['site', 'workflows']);
    expect(await zip.lines('records')).toEqual([
      expect.objectContaining({
        id: 'a1',
        current: expect.objectContaining({
          attributes: { title: 'Record a1' },
        }),
        published: expect.objectContaining({
          attributes: { title: 'Published' },
        }),
        scheduledPublication: null,
        scheduledUnpublishing: null,
      }),
      expect.objectContaining({ id: 'a2', published: null }),
      expect.objectContaining({
        id: 'a3',
        scheduledPublication: expect.objectContaining({
          type: 'scheduled_publication',
        }),
      }),
      expect.objectContaining({ id: 'p1' }),
    ]);
    expect(await zip.lines('uploads')).toHaveLength(2);
    expect(await zip.lines('upload-collections')).toEqual([
      expect.objectContaining({ id: 'folder-1' }),
    ]);
  });

  test('reads records as the CLI does: blocks nested only where models hold them', async () => {
    const { client, project } = fakeProject();
    await writeProjectDump({
      client,
      environment: 'main',
      primary: false,
      includeAssets: false,
    });
    const listings = project.queries.filter(
      (query) => query.version === 'current' && query.page.limit > 0,
    );
    expect(listings).toEqual([
      expect.objectContaining({
        filter: { type: 'article' },
        nested: true,
        order_by: 'id_ASC',
        page: { offset: 0, limit: 30 },
      }),
      expect.objectContaining({
        filter: { type: 'person' },
        nested: false,
        page: { offset: 0, limit: 500 },
      }),
    ]);
    expect(
      project.queries.filter((query) => query.version === 'published'),
    ).toEqual([
      expect.objectContaining({ filter: { ids: 'a1,a3' }, nested: true }),
      expect.objectContaining({ filter: { ids: 'p1' }, nested: false }),
    ]);
  });

  test('splits JSON lines entries at the entry size', async () => {
    const { client, project } = fakeProject();
    for (let index = 0; index < 40; index++)
      project.records.push(row(`p${index + 10}`, 'person'));
    const { blob } = await writeProjectDump({
      client,
      environment: 'main',
      primary: false,
      includeAssets: false,
      entryBytes: 1000,
    });
    const zip = await readZip(blob);
    const entries = zip.names.filter((name) => name.startsWith('records/'));

    expect(entries.length).toBeGreaterThan(5);
    expect(entries[0]).toBe('records/000001.jsonl');
    for (const content of await Promise.all(entries.map(zip.text)))
      expect(new Blob([content]).size).toBeLessThanOrEqual(1000);
    expect(await zip.lines('records')).toHaveLength(44);
    expect(zip.manifest.counts.records).toBe(44);
  });

  test('stores asset files as uploaded, checked against their MD5', async () => {
    const { client } = fakeProject();
    const { blob } = await writeProjectDump({
      client,
      environment: 'main',
      primary: false,
      includeAssets: true,
    });
    const zip = await readZip(blob);

    expect(zip.manifest.includesAssets).toBe(true);
    expect(zip.names).toContain('assets/upload-1/upload-1.txt');
    expect(await zip.data('assets/upload-2/upload-2.txt')).toEqual(
      files['upload-2'],
    );
    expect(zip.names.at(-1)).toBe('manifest.json');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.datocms-assets.com/1/upload-1.txt?skip-default-optimizations=true&svg-sanitize=false',
      expect.anything(),
    );
  });

  test('fails when an asset file does not match its MD5', async () => {
    const { client, project } = fakeProject();
    project.uploads[1].md5 = md5(bytes('another file'));

    await expect(
      writeProjectDump({
        client,
        environment: 'main',
        primary: false,
        includeAssets: true,
      }),
    ).rejects.toThrow('Asset upload-2 changed while it was exported.');
  });

  test('fails when a record is unpublished between its two reads', async () => {
    const { client, project } = fakeProject();
    project.unpublished.add('a3');

    await expect(
      writeProjectDump({
        client,
        environment: 'main',
        primary: false,
        includeAssets: false,
      }),
    ).rejects.toThrow('Publication state changed while reading record a3.');
  });

  test('fails when the media library changes while it is read', async () => {
    const { client, project } = fakeProject();
    project.uploadTotal = 3;

    await expect(
      writeProjectDump({
        client,
        environment: 'main',
        primary: false,
        includeAssets: false,
      }),
    ).rejects.toThrow('A collection changed while it was being read.');
  });

  test('releases its open entry when it fails, so the next dump can run', async () => {
    // zip.js shares its add slots between zips; with one, an entry left open
    // by a failed dump would block every later one.
    configure({ maxWorkers: 1 });
    try {
      const failing = fakeProject();
      failing.project.unpublished.add('p1');
      await expect(
        writeProjectDump({
          client: failing.client,
          environment: 'main',
          primary: false,
          includeAssets: false,
        }),
      ).rejects.toThrow('Publication state changed while reading record p1.');

      const { client } = fakeProject();
      const { manifest } = await writeProjectDump({
        client,
        environment: 'main',
        primary: false,
        includeAssets: false,
      });
      expect(manifest.counts.records).toBe(4);
    } finally {
      configure({ maxWorkers: navigator.hardwareConcurrency || 2 });
    }
  });

  test('refuses a role that may not read every model', async () => {
    const { client, project } = fakeProject();
    const rule = {
      action: 'read',
      environment: 'main',
      on_creator: 'anyone',
      on_stage: null,
      localization_scope: 'all',
    };
    project.actor = {
      type: 'user',
      role: {
        id: 'editor',
        meta: {
          final_permissions: {
            positive_item_type_permissions: [{ ...rule, item_type: 'article' }],
            negative_item_type_permissions: [],
            positive_upload_permissions: [rule],
            negative_upload_permissions: [],
          },
        },
      },
    };

    await expect(
      writeProjectDump({
        client,
        environment: 'main',
        primary: false,
        includeAssets: false,
      }),
    ).rejects.toThrow(
      'Your role may not read every record of model person in main.',
    );
  });
});

describe('downloadProjectDump', () => {
  test('downloads the dump under the CLI file name and reports its counts', async () => {
    const { client } = fakeProject();
    mocks.buildClient.mockReturnValue(client);
    const onProgress = vi.fn();
    await downloadProjectDump(
      'token',
      'main',
      undefined,
      { primary: true, includeAssets: true },
      onProgress,
    );

    expect(mocks.buildClient).toHaveBeenCalledWith({
      apiToken: 'token',
      environment: 'main',
      baseUrl: undefined,
    });
    const [blob, filename] = mocks.downloadBlob.mock.calls[0];
    expect(filename).toMatch(/^\d+_main\.dump-records-assets\.zip$/);
    expect((await readZip(blob)).manifest.counts.records).toBe(4);
    expect(onProgress).toHaveBeenLastCalledWith(
      100,
      `Exported 4 records, 2 uploads and 1 folders to ${filename}.`,
    );
  });

  test('downloads nothing when cancelled', async () => {
    const { client } = fakeProject();
    mocks.buildClient.mockReturnValue(client);
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadProjectDump(
        'token',
        'main',
        undefined,
        { primary: true, includeAssets: false },
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow('Export cancelled.');
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});
