import { buildClient, type Client } from '@datocms/cma-client-browser';
import { BlobReader, TextReader, type ZipWriter } from '@zip.js/zip.js';
import { downloadAssetFile, originalFileUrl } from './assetDownload';
import { mapWithConcurrency, throwIfAborted } from './exportRuntime';
import { ExportWorkspace } from './exportWorkspace';
import { PLUGIN_VERSION } from './recordExport';

// The dump is the one `datocms content:export` writes, so that
// `datocms content:diff --source-dump` reads it. Keep this file in step with
// the content diff plugin's engine/dump.ts and engine/capture.ts.

export const DUMP_FORMAT = 'datocms-project-dump';
export const DUMP_VERSION = 1;
/** Entries of JSON lines are split at this size, as content:export does. */
export const DUMP_ENTRY_BYTES = 64 * 1024 * 1024;
const BLOCK_FIELD_TYPES = ['rich_text', 'single_block', 'structured_text'];
const ASSET_FILE = 'asset.download';

export type DumpManifest = {
  format: typeof DUMP_FORMAT;
  version: typeof DUMP_VERSION;
  createdAt: string;
  pluginVersion: string;
  site: { id: string; environment: string; primary: boolean };
  locales: string[];
  includesAssets: boolean;
  counts: { records: number; uploads: number; uploadCollections: number };
};

type ExportClient = Client;
type Progress = (progress: number, message: string) => void;
type JsonObject = Record<string, unknown>;
type Resource = {
  id: string;
  type: string;
  attributes: JsonObject;
  relationships?: Record<string, { data: unknown }>;
  meta?: JsonObject;
};
type Page<T> = { data: T[]; total: number };
type Model = {
  id: string;
  apiKey: string;
  workflowId: string | null;
  nested: boolean;
};
type Asset = {
  id: string;
  url: string;
  filename: string;
  md5: string;
  size: number;
};

class ContentChangedError extends Error {
  constructor(detail: string) {
    super(
      `${detail} Keep content unchanged while the dump is written, then export again.`,
    );
    this.name = 'ContentChangedError';
  }
}

export class IncompleteAccessError extends Error {
  constructor(what: string) {
    super(
      `Your role cannot read ${what} in this environment, so the dump would be incomplete. Ask an administrator to export it.`,
    );
    this.name = 'IncompleteAccessError';
  }
}

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relationshipId(resource: Resource, name: string): string | null {
  const data = resource.relationships?.[name]?.data;
  return object(data) && typeof data.id === 'string' ? data.id : null;
}

/** The models with records, and whether reading them needs `nested`. */
function modelsOf(site: { included?: Resource[] }): Model[] {
  const included = site.included ?? [];
  const nested = new Set(
    included
      .filter(
        (entry) =>
          entry.type === 'field' &&
          BLOCK_FIELD_TYPES.includes(String(entry.attributes.field_type)),
      )
      .map((field) => relationshipId(field, 'item_type')),
  );
  return included
    .filter(
      (entry) => entry.type === 'item_type' && !entry.attributes.modular_block,
    )
    .map((model) => ({
      id: model.id,
      apiKey: String(model.attributes.api_key),
      workflowId: relationshipId(model, 'workflow'),
      nested: nested.has(model.id),
    }));
}

function rules(value: unknown, what: string): JsonObject[] {
  if (!Array.isArray(value) || !value.every(object))
    throw new IncompleteAccessError(what);
  return value;
}

/**
 * Refuses an export the current user's role would leave incomplete: a model,
 * a locale, a workflow stage or an asset folder it cannot read would be
 * missing from the dump, and a diff from that dump would delete it.
 */
async function assertFullReadAccess(
  client: ExportClient,
  environment: string,
  models: Model[],
): Promise<void> {
  const actor: JsonObject = { ...(await client.users.findMe()) };
  if (
    actor.type === 'account' ||
    actor.type === 'organization' ||
    (actor.type === 'access_token' && actor.hardcoded_type === 'admin')
  )
    return;
  const everything = 'every record and asset';
  if (!object(actor.role) || typeof actor.role.id !== 'string')
    throw new IncompleteAccessError(everything);
  const role: JsonObject = { ...(await client.roles.find(actor.role.id)) };
  const permissions = object(role.meta) ? role.meta.final_permissions : null;
  if (!object(permissions)) throw new IncompleteAccessError(everything);
  const applicable = (rule: JsonObject) =>
    (rule.action === 'read' || rule.action === 'all') &&
    rule.environment === environment;
  const unrestricted = (rule: JsonObject) =>
    rule.on_creator === 'anyone' &&
    !rule.on_stage &&
    (rule.localization_scope === undefined ||
      rule.localization_scope === null ||
      rule.localization_scope === 'all');
  const positives = rules(
    permissions.positive_item_type_permissions,
    everything,
  );
  const negatives = rules(
    permissions.negative_item_type_permissions,
    everything,
  );
  for (const model of models) {
    const matches = (rule: JsonObject) =>
      rule.item_type
        ? rule.item_type === model.id
        : rule.workflow
          ? rule.workflow === model.workflowId
          : true;
    if (
      !positives.some(
        (rule) => applicable(rule) && unrestricted(rule) && matches(rule),
      ) ||
      negatives.some((rule) => applicable(rule) && matches(rule))
    )
      throw new IncompleteAccessError(
        `every record of the ${model.apiKey} model`,
      );
  }
  if (
    !rules(permissions.positive_upload_permissions, everything).some(
      (rule) =>
        applicable(rule) && unrestricted(rule) && !rule.upload_collection,
    ) ||
    rules(permissions.negative_upload_permissions, everything).some(applicable)
  )
    throw new IncompleteAccessError('every asset');
}

/**
 * Reads a collection page by page, in order. A total or a page length that
 * disagrees with the first read means the collection changed meanwhile.
 */
async function readPages<T>(
  read: (offset: number, limit: number) => Promise<Page<T>>,
  limit: number,
  consume: (rows: T[]) => Promise<void>,
  signal?: AbortSignal,
): Promise<number> {
  let offset = 0;
  let total: number | undefined;
  while (total === undefined || offset < total) {
    throwIfAborted(signal);
    // biome-ignore lint/performance/noAwaitInLoops: One page is held in memory at a time.
    const page = await read(offset, limit);
    total ??= page.total;
    if (
      page.total !== total ||
      page.data.length !== Math.min(limit, total - offset)
    )
      throw new ContentChangedError('Content changed while it was being read.');
    await consume(page.data);
    offset += page.data.length;
  }
  return total;
}

async function readItems(
  client: ExportClient,
  queryParams: JsonObject,
): Promise<Page<Resource>> {
  // The SDK's deserializer would reshape the records; the dump keeps them as
  // the CMA returns them.
  const body = await client.request<{
    data: Resource[];
    meta: { total_count: number };
  }>({ method: 'GET', url: '/items', queryParams });
  return { data: body.data, total: body.meta.total_count };
}

/** A page of current records, each with its published version or null. */
async function recordLines(
  client: ExportClient,
  rows: Resource[],
  nested: boolean,
) {
  const published = new Map<string, Resource>();
  const ids = rows.filter((row) => row.meta?.published_at).map((row) => row.id);
  // A filter of IDs travels in the URL, so long lists are split.
  const size = Math.min(nested ? 30 : 100, rows.length);
  for (let start = 0; start < ids.length; start += size) {
    const chunk = ids.slice(start, start + size);
    // biome-ignore lint/performance/noAwaitInLoops: Chunks are read one at a time to bound memory.
    const { data } = await readItems(client, {
      filter: { ids: chunk.join(',') },
      nested,
      version: 'published',
      page: { limit: chunk.length },
    });
    for (const resource of data) published.set(resource.id, resource);
  }
  return rows.map((row) => {
    const pub = published.get(row.id) ?? null;
    if (Boolean(row.meta?.published_at) !== Boolean(pub))
      throw new ContentChangedError(
        `Record ${row.id} was published or unpublished while it was being read.`,
      );
    return { id: row.id, current: row, published: pub };
  });
}

/** JSON lines in numbered zip entries of at most `limit` bytes. */
export class JsonLines {
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private added?: Promise<unknown>;
  private bytes = 0;
  private entries = 0;
  private readonly encoder = new TextEncoder();
  count = 0;

  constructor(
    private readonly zip: ZipWriter<unknown>,
    private readonly prefix: string,
    private readonly limit = DUMP_ENTRY_BYTES,
  ) {}

  async write(value: unknown): Promise<void> {
    const line = this.encoder.encode(`${JSON.stringify(value)}\n`);
    if (!this.writer || this.bytes + line.byteLength > this.limit) {
      await this.end();
      this.entries++;
      const entry = new TransformStream<Uint8Array, Uint8Array>();
      this.added = this.zip.add(
        `${this.prefix}/${String(this.entries).padStart(6, '0')}.jsonl`,
        entry.readable,
      );
      const writer = entry.writable.getWriter();
      // A zip failure fails the pending write; `end` reports it.
      this.added.catch((error) => writer.abort(error).catch(() => undefined));
      this.writer = writer;
      this.bytes = 0;
    }
    this.bytes += line.byteLength;
    this.count++;
    await this.writer.write(line);
  }

  async end(): Promise<void> {
    if (!this.writer) return;
    await this.writer.close();
    await this.added;
    this.writer = undefined;
  }
}

type DumpWriter = {
  client: ExportClient;
  workspace: ExportWorkspace;
  zip: ZipWriter<unknown>;
  signal?: AbortSignal;
};

/** Reports progress between `from` and `to` percent of the whole export. */
type PhaseProgress = (fraction: number, message: string) => void;

function phase(from: number, to: number, onProgress?: Progress): PhaseProgress {
  return (fraction, message) =>
    onProgress?.(from + (to - from) * Math.min(1, fraction), message);
}

/** Every record of every model, current and published, as JSON lines. */
async function writeRecords(
  { client, zip, signal }: DumpWriter,
  models: Model[],
  progress: PhaseProgress,
): Promise<number> {
  const counts = await mapWithConcurrency(models, 4, async (model) => {
    throwIfAborted(signal);
    return (
      await readItems(client, {
        filter: { type: model.id },
        page: { limit: 0 },
      })
    ).total;
  });
  const expected = counts.reduce((sum, count) => sum + count, 0);
  const records = new JsonLines(zip, 'records');
  const seen = new Set<string>();
  for (const model of models) {
    // biome-ignore lint/performance/noAwaitInLoops: Models are read one at a time into one zip entry.
    await readPages(
      (offset, limit) =>
        readItems(client, {
          filter: { type: model.id },
          nested: model.nested,
          version: 'current',
          order_by: 'id_ASC',
          page: { offset, limit },
        }),
      model.nested ? 30 : 500,
      async (rows) => {
        for (const line of await recordLines(client, rows, model.nested)) {
          // A record listed twice moved between pages meanwhile.
          if (seen.has(line.id))
            throw new ContentChangedError(
              `Record ${line.id} was listed twice.`,
            );
          seen.add(line.id);
          // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order, with backpressure.
          await records.write(line);
        }
        progress(
          records.count / (expected || 1),
          `Exported ${records.count}/${expected} records...`,
        );
      },
      signal,
    );
  }
  await records.end();
  return records.count;
}

/** Every upload and upload folder, as JSON lines. */
async function writeUploads({ client, zip, signal }: DumpWriter) {
  const uploadCount = async () =>
    (await client.uploads.rawList({ page: { limit: 1 } })).meta.total_count;
  const uploads = new JsonLines(zip, 'uploads');
  const assets: Asset[] = [];
  const listed = new Set<string>();
  const total = await readPages(
    async (offset, limit) => {
      const [data, live] = await Promise.all([
        client.uploads.list({ order_by: 'id_ASC', page: { offset, limit } }),
        uploadCount(),
      ]);
      return { data, total: live };
    },
    500,
    async (rows) => {
      for (const upload of rows) {
        if (listed.has(upload.id))
          throw new ContentChangedError(`Asset ${upload.id} was listed twice.`);
        listed.add(upload.id);
        // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order, with backpressure.
        await uploads.write(upload);
        assets.push({
          id: upload.id,
          url: upload.url,
          filename: upload.filename,
          md5: upload.md5,
          size: upload.size,
        });
      }
    },
    signal,
  );
  if ((await uploadCount()) !== total)
    throw new ContentChangedError('Assets changed while they were being read.');
  await uploads.end();

  const collections = new JsonLines(zip, 'upload-collections');
  for (const collection of await client.uploadCollections.list()) {
    // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order, with backpressure.
    await collections.write(collection);
  }
  await collections.end();
  return { assets, uploads: uploads.count, collections: collections.count };
}

/** Every asset's original file, checked against its MD5. */
async function writeAssetFiles(
  { workspace, zip, signal }: DumpWriter,
  assets: Asset[],
  progress: PhaseProgress,
): Promise<void> {
  for (let index = 0; index < assets.length; index++) {
    throwIfAborted(signal);
    const asset = assets[index];
    progress(
      index / assets.length,
      `Downloading asset files (${index + 1}/${assets.length})...`,
    );
    let file: File;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: One download at a time keeps a single asset file on disk besides the zip.
      file = await downloadAssetFile(
        originalFileUrl(asset.url),
        workspace,
        ASSET_FILE,
        { signal, expectedBytes: asset.size, md5: asset.md5 },
      );
    } catch (error) {
      throwIfAborted(signal);
      throw new Error(
        `Asset ${asset.id} could not be downloaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await zip.add(
      `assets/${asset.id}/${asset.filename.replace(/[/\\]/g, '_')}`,
      new BlobReader(file),
      { level: 0 },
    );
  }
  await workspace.remove(ASSET_FILE);
}

async function writeDump(args: {
  client: ExportClient;
  workspace: ExportWorkspace;
  filename: string;
  environment: string;
  primary: boolean;
  includeAssets: boolean;
  onProgress?: Progress;
  signal?: AbortSignal;
}): Promise<DumpManifest> {
  const { client, workspace, includeAssets, onProgress } = args;
  const recordsEnd = includeAssets ? 45 : 85;
  const uploadsEnd = includeAssets ? 50 : 98;

  onProgress?.(0, 'Reading the schema...');
  const [site, workflows] = await Promise.all([
    client.site.rawFind({ include: 'item_types,item_types.fields' }),
    client.workflows.list(),
  ]);
  const models = modelsOf(site as unknown as { included?: Resource[] });
  await assertFullReadAccess(client, args.environment, models);

  const zip = await workspace.zip(args.filename);
  const writer: DumpWriter = { client, workspace, zip, signal: args.signal };
  await zip.add(
    'schema.json',
    new TextReader(JSON.stringify({ site, workflows })),
  );
  const records = await writeRecords(
    writer,
    models,
    phase(0, recordsEnd, onProgress),
  );
  onProgress?.(recordsEnd, 'Reading asset metadata...');
  const { assets, uploads, collections } = await writeUploads(writer);
  if (includeAssets)
    await writeAssetFiles(writer, assets, phase(uploadsEnd, 98, onProgress));

  onProgress?.(98, 'Finishing the dump...');
  const { data } = site as unknown as { data: Resource };
  const manifest: DumpManifest = {
    format: DUMP_FORMAT,
    version: DUMP_VERSION,
    createdAt: new Date().toISOString(),
    pluginVersion: PLUGIN_VERSION,
    site: { id: data.id, environment: args.environment, primary: args.primary },
    locales: (data.attributes.locales as string[] | undefined) ?? [],
    includesAssets: includeAssets,
    counts: { records, uploads, uploadCollections: collections },
  };
  await zip.add(
    'manifest.json',
    new TextReader(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  await zip.close();
  return manifest;
}

/**
 * Exports an environment as a project dump, assembled on disk and downloaded
 * once complete: its schema, every record (current and published versions,
 * with their schedules), upload and folder as JSON lines, and optionally
 * every asset's file. Nothing is downloaded when it fails or is cancelled.
 */
export async function exportProjectDump(args: {
  apiToken: string;
  environment: string;
  primary: boolean;
  baseUrl?: string;
  includeAssets: boolean;
  onProgress?: Progress;
  signal?: AbortSignal;
}): Promise<{ filename: string; manifest: DumpManifest }> {
  const client = buildClient({
    apiToken: args.apiToken,
    environment: args.environment,
    baseUrl: args.baseUrl,
  });
  const workspace = await ExportWorkspace.open();
  const filename = `${Math.floor(Date.now() / 1000)}_${args.environment}.dump-records${args.includeAssets ? '-assets' : ''}.zip`;
  let manifest: DumpManifest;
  try {
    manifest = await writeDump({ ...args, client, workspace, filename });
  } catch (error) {
    await workspace.clear();
    throw error;
  }
  await workspace.download(filename);
  args.onProgress?.(
    100,
    `Project dump ${filename} exported: ${manifest.counts.records} records and ${manifest.counts.uploads} assets.`,
  );
  return { filename, manifest };
}
