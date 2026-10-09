import {
  ApiError,
  buildClient,
  type Client,
} from '@datocms/cma-client-browser';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import SparkMD5 from 'spark-md5';
import {
  downloadBlob,
  mapWithConcurrency,
  throwIfAborted,
} from './exportRuntime';
import { PLUGIN_VERSION } from './recordExport';

// A project dump is the zip `datocms content:export` writes and
// `datocms content:diff --source-dump` reads (@datocms/cli-plugin-content-diff).
// Its lines hold what the CMA returns, so this reads the same endpoints with
// the same parameters and refuses the same inconsistencies as the CLI.
const FORMAT = 'datocms-project-dump';
const VERSION = 1;
/** JSON lines entries are split at this size, as the CLI splits them. */
export const ENTRY_BYTES = 64 * 1024 * 1024;
const CONCURRENCY = 4;
const BLOCK_FIELD_TYPES = new Set([
  'rich_text',
  'single_block',
  'structured_text',
]);

export type DumpManifest = {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  pluginVersion: string;
  site: { id: string; environment: string; primary: boolean };
  locales: string[];
  includesAssets: boolean;
  counts: { records: number; uploads: number; uploadCollections: number };
};

type Progress = (progress: number, message: string) => void;
type RawSchema = {
  site: Awaited<ReturnType<Client['site']['rawFind']>>;
  workflows: Awaited<ReturnType<Client['workflows']['list']>>;
};
type Model = {
  id: string;
  apiKey: string;
  workflowId: string | null;
  /** Whether its records hold blocks, which only `nested` reads expand. */
  nested: boolean;
};
type Page = { data: unknown[]; total: number };
type NativeRow = {
  id: string;
  meta: Record<string, string | null | undefined>;
};
type ScheduleResource = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
};
type RecordLine = {
  id: string;
  current: NativeRow;
  published: unknown | null;
  scheduledPublication: ScheduleResource | null;
  scheduledUnpublishing: ScheduleResource | null;
};
type Asset = { id: string; url: string; filename: string; md5: string };
type Rule = Record<string, unknown>;

const encoder = new TextEncoder();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function changed(message: string): Error {
  return new Error(
    `${message} Avoid editing the project while it exports, then try again.`,
  );
}

function unproven(message: string): Error {
  return new Error(
    `${message} A project dump needs a role that can read every record and asset.`,
  );
}

/** Where an asset's file sits in a dump. */
export function assetEntryName(id: string, filename: string): string {
  return `assets/${id}/${filename.replace(/[/\\]/g, '_')}`;
}

/** The asset's file as uploaded, without image optimizations or SVG sanitizing. */
export function originalFileUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('skip-default-optimizations', 'true');
  parsed.searchParams.set('svg-sanitize', 'false');
  return parsed.toString();
}

export function dumpFilename(
  environment: string,
  includeAssets: boolean,
  date = new Date(),
): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return `${seconds}_${environment}.dump-records${includeAssets ? '-assets' : ''}.zip`;
}

/**
 * JSON lines under `prefix`, split into `prefix/000001.jsonl`, … entries.
 * Writes run one after another, so a new entry never ends one that another
 * write is still filling.
 */
class JsonLines {
  count = 0;
  private entries = 0;
  private bytes = 0;
  private entry?: {
    writer: WritableStreamDefaultWriter<Uint8Array>;
    added: Promise<unknown>;
  };
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly zip: ZipWriter<Blob>,
    private readonly prefix: string,
    private readonly limit: number,
  ) {}

  write(value: unknown): Promise<void> {
    return this.enqueue(() => this.writeLine(value));
  }

  /** Finishes the open entry; call it before adding anything else. */
  end(): Promise<void> {
    return this.enqueue(() => this.endEntry());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => {});
    return next;
  }

  private async writeLine(value: unknown): Promise<void> {
    const line = encoder.encode(`${JSON.stringify(value)}\n`);
    if (!this.entry || this.bytes + line.byteLength > this.limit) {
      await this.endEntry();
      this.entries++;
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const added = this.zip.add(
        `${this.prefix}/${String(this.entries).padStart(6, '0')}.jsonl`,
        stream.readable,
      );
      added.catch(() => {});
      this.entry = { writer: stream.writable.getWriter(), added };
      this.bytes = 0;
    }
    this.bytes += line.byteLength;
    this.count++;
    // The entry's failure rejects `added`, while the write would wait forever.
    await Promise.race([this.entry.writer.write(line), this.entry.added]);
  }

  /** Abandons the open entry, so the zip stops waiting for its data. */
  async abort(reason: unknown): Promise<void> {
    const entry = this.entry;
    this.entry = undefined;
    await entry?.writer.abort(reason).catch(() => {});
    await entry?.added.catch(() => {});
  }

  private async endEntry(): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    this.entry = undefined;
    await Promise.race([entry.writer.close(), entry.added]);
    await entry.added;
  }
}

async function readSchema(client: Client): Promise<RawSchema> {
  const [site, workflows] = await Promise.all([
    client.site.rawFind({ include: 'item_types,item_types.fields' }),
    client.workflows.list(),
  ]);
  return { site, workflows };
}

/** The models whose records a dump holds: every model but blocks. */
function recordModels(schema: RawSchema): Model[] {
  const included = schema.site.included ?? [];
  const nested = new Set<string>();
  for (const entry of included)
    if (
      entry.type === 'field' &&
      BLOCK_FIELD_TYPES.has(entry.attributes.field_type)
    )
      nested.add(entry.relationships.item_type.data.id);
  return included.flatMap((entry) =>
    entry.type === 'item_type' && !entry.attributes.modular_block
      ? [
          {
            id: entry.id,
            apiKey: entry.attributes.api_key,
            workflowId: entry.relationships.workflow.data?.id ?? null,
            nested: nested.has(entry.id),
          },
        ]
      : [],
  );
}

function rules(value: unknown): Rule[] {
  if (!Array.isArray(value) || !value.every(isObject))
    throw unproven('Your effective permission rules are unavailable.');
  return value;
}

/** The current user's effective permissions, or null when nothing limits them. */
async function effectivePermissions(
  client: Client,
): Promise<Record<string, unknown> | null> {
  const actor: unknown = await client.users.findMe({ include: 'role' });
  if (!isObject(actor)) throw unproven('The CMA did not return your user.');
  if (
    actor.type === 'account' ||
    actor.type === 'organization' ||
    (actor.type === 'access_token' && actor.hardcoded_type === 'admin')
  )
    return null;
  if (!isObject(actor.role) || typeof actor.role.id !== 'string')
    throw unproven('Your role cannot be inspected.');
  const role: unknown =
    isObject(actor.role.meta) && isObject(actor.role.meta.final_permissions)
      ? actor.role
      : await client.roles.find(actor.role.id);
  if (
    !isObject(role) ||
    !isObject(role.meta) ||
    !isObject(role.meta.final_permissions)
  )
    throw unproven('Your role does not expose its effective permissions.');
  if (
    actor.type === 'access_token' &&
    role.meta.final_permissions.can_manage_upload_collections !== true
  )
    throw unproven('Your token cannot read upload folders.');
  return role.meta.final_permissions;
}

/** Refuses a role that could leave records or uploads out of the dump. */
async function assertFullReadAccess(
  client: Client,
  environment: string,
  models: Model[],
): Promise<void> {
  const permissions = await effectivePermissions(client);
  if (!permissions) return;
  const applicable = (rule: Rule) =>
    (rule.action === 'read' || rule.action === 'all') &&
    rule.environment === environment;
  const unrestricted = (rule: Rule) =>
    rule.on_creator === 'anyone' &&
    !rule.on_stage &&
    (rule.localization_scope === undefined ||
      rule.localization_scope === null ||
      rule.localization_scope === 'all');
  const positives = rules(permissions.positive_item_type_permissions);
  const negatives = rules(permissions.negative_item_type_permissions);
  for (const model of models) {
    const matches = (rule: Rule) =>
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
      throw unproven(
        `Your role may not read every record of model ${model.apiKey} in ${environment}.`,
      );
  }
  if (
    !rules(permissions.positive_upload_permissions).some(
      (rule) =>
        applicable(rule) && unrestricted(rule) && !rule.upload_collection,
    ) ||
    rules(permissions.negative_upload_permissions).some(applicable)
  )
    throw unproven(`Your role may not read every asset in ${environment}.`);
}

/**
 * Reads every page of a collection, `limit` rows at a time, and refuses one
 * whose total or page sizes change while it is read.
 */
async function pages(
  read: (offset: number) => Promise<Page>,
  limit: number,
  consume: (rows: unknown[]) => Promise<void>,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const first = await read(0);
  const accept = async (page: Page, offset: number) => {
    throwIfAborted(signal);
    if (
      page.total !== first.total ||
      page.data.length !== Math.min(limit, first.total - offset)
    )
      throw changed('A collection changed while it was being read.');
    await consume(page.data);
  };
  await accept(first, 0);
  const offsets: number[] = [];
  for (let offset = limit; offset < first.total; offset += limit)
    offsets.push(offset);
  await mapWithConcurrency(offsets, CONCURRENCY, async (offset) =>
    accept(await read(offset), offset),
  );
  return first.total;
}

/** Records as the CMA returns them, without the SDK's deserialization. */
async function readItems(
  client: Client,
  queryParams: Record<string, unknown>,
): Promise<Page> {
  const body = await client.request<{
    data: unknown[];
    meta: { total_count: number };
  }>({ method: 'GET', url: '/items', queryParams });
  return { data: body.data, total: body.meta.total_count };
}

const at = (value: unknown) =>
  typeof value === 'string' ? new Date(value).toISOString() : null;

/** A record's scheduled publication and unpublishing, as the CMA returns them. */
async function readSchedules(
  client: Client,
  record: NativeRow,
): Promise<[ScheduleResource | null, ScheduleResource | null]> {
  const publicationAt = record.meta.publication_scheduled_at;
  const unpublishingAt = record.meta.unpublishing_scheduled_at;
  if (!publicationAt && !unpublishingAt) return [null, null];
  let body: {
    data: { relationships: Record<string, { data: { id: string } | null }> };
    included?: ScheduleResource[];
  };
  try {
    body = (await client.items.rawCurrentVsPublishedState(
      record.id,
    )) as unknown as typeof body;
  } catch (error) {
    // The record was listed a moment ago, so it was deleted meanwhile.
    if (error instanceof ApiError && error.response.status === 404)
      throw changed(`Record ${record.id} was deleted during the export.`);
    throw error;
  }
  const resource = (key: string) => {
    const id = body.data.relationships[key]?.data?.id;
    return (
      body.included?.find((entry) => entry.id === id && entry.type === key) ??
      null
    );
  };
  const publication = resource('scheduled_publication');
  const unpublishing = resource('scheduled_unpublishing');
  // The listing and this read are two requests: a schedule that changed
  // between them makes the marker and the details disagree.
  if (
    at(publicationAt) !==
      at(publication?.attributes.publication_scheduled_at) ||
    at(unpublishingAt) !==
      at(unpublishing?.attributes.unpublishing_scheduled_at)
  )
    throw changed('A record schedule changed during the export.');
  return [publication, unpublishing];
}

/**
 * One listed page of current records as complete record lines: their
 * published versions, read by ID, and their schedules.
 */
async function recordLines(
  client: Client,
  rows: NativeRow[],
  nested: boolean,
): Promise<RecordLine[]> {
  const published = new Map<string, unknown>();
  const ids = rows.filter((row) => row.meta.published_at).map((row) => row.id);
  // A filter of IDs travels in the URL, so long lists are split.
  const size = nested ? 30 : 100;
  for (let start = 0; start < ids.length; start += size) {
    const chunk = ids.slice(start, start + size);
    // biome-ignore lint/performance/noAwaitInLoops: One chunk of published versions at a time bounds memory.
    const page = await readItems(client, {
      filter: { ids: chunk.join(',') },
      nested,
      version: 'published',
      page: { limit: chunk.length },
    });
    for (const resource of page.data as NativeRow[])
      published.set(resource.id, resource);
  }
  const lines = rows.map((row): RecordLine => {
    const version = published.get(row.id) ?? null;
    // The current and published versions are two requests.
    if (Boolean(row.meta.published_at) !== Boolean(version))
      throw changed(
        `Publication state changed while reading record ${row.id}.`,
      );
    return {
      id: row.id,
      current: row,
      published: version,
      scheduledPublication: null,
      scheduledUnpublishing: null,
    };
  });
  // Schedule details cost one request per scheduled record. Few records are
  // scheduled, so they are read together rather than one after another.
  await mapWithConcurrency(
    lines.filter(
      ({ current }) =>
        current.meta.publication_scheduled_at ||
        current.meta.unpublishing_scheduled_at,
    ),
    CONCURRENCY,
    async (line) => {
      [line.scheduledPublication, line.scheduledUnpublishing] =
        await readSchedules(client, line.current);
    },
  );
  return lines;
}

async function countRecords(
  client: Client,
  models: Model[],
  signal?: AbortSignal,
): Promise<number> {
  const counts = await mapWithConcurrency(
    models,
    CONCURRENCY,
    async (model) => {
      throwIfAborted(signal);
      const page = await readItems(client, {
        filter: { type: model.id },
        version: 'current',
        page: { limit: 0 },
      });
      return page.total;
    },
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

async function writeRecords(
  client: Client,
  models: Model[],
  records: JsonLines,
  onRecord: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const seen = new Set<string>();
  for (const model of models) {
    const limit = model.nested ? 30 : 500;
    // biome-ignore lint/performance/noAwaitInLoops: Models are read one after another, as the CLI reads them.
    await pages(
      (offset) =>
        readItems(client, {
          filter: { type: model.id },
          nested: model.nested,
          version: 'current',
          order_by: 'id_ASC',
          page: { offset, limit },
        }),
      limit,
      async (rows) => {
        for (const line of await recordLines(
          client,
          rows as NativeRow[],
          model.nested,
        )) {
          throwIfAborted(signal);
          // A record listed twice moved between pages meanwhile.
          if (seen.has(line.id))
            throw changed(`Record ${line.id} was listed twice.`);
          seen.add(line.id);
          // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order, waiting for the zip to take each.
          await records.write(line);
          onRecord();
        }
      },
      signal,
    );
  }
}

/** Every upload, as the SDK lists them; returns their files. */
async function writeUploads(
  client: Client,
  uploads: JsonLines,
  signal?: AbortSignal,
): Promise<Asset[]> {
  // A single-row raw page read supplies the live total, which uploads.list
  // does not return: the first page's finishes before that page is listed,
  // every later page reads one alongside its listing, and one more follows
  // the last page.
  const count = async () =>
    (await client.uploads.rawList({ page: { limit: 1 } })).meta.total_count;
  const assets: Asset[] = [];
  const seen = new Set<string>();
  const total = await pages(
    async (offset) => {
      const first = offset === 0 ? await count() : undefined;
      const [data, live] = await Promise.all([
        client.uploads.list({
          order_by: 'id_ASC',
          page: { offset, limit: 500 },
        }),
        first ?? count(),
      ]);
      return { data, total: live };
    },
    500,
    async (rows) => {
      for (const upload of rows as Asset[]) {
        throwIfAborted(signal);
        if (seen.has(upload.id))
          throw changed(`Upload ${upload.id} was listed twice.`);
        seen.add(upload.id);
        // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order, waiting for the zip to take each.
        await uploads.write(upload);
        const { id, url, filename, md5 } = upload;
        assets.push({ id, url, filename, md5 });
      }
    },
    signal,
  );
  if ((await count()) !== total)
    throw changed('The media library changed while it was being read.');
  return assets;
}

/** Adds an asset's file, failing when its bytes do not match its MD5. */
async function addAssetFile(
  zip: ZipWriter<Blob>,
  asset: Asset,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(originalFileUrl(asset.url), { signal });
  if (!response.ok || !response.body)
    throw new Error(
      `Asset ${asset.id} could not be downloaded (HTTP ${response.status}).`,
    );
  const md5 = new SparkMD5.ArrayBuffer();
  const verified = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        md5.append(chunk.slice().buffer);
        controller.enqueue(chunk);
      },
      flush() {
        if (md5.end() !== asset.md5.toLowerCase())
          throw changed(`Asset ${asset.id} changed while it was exported.`);
      },
    }),
  );
  // Asset files are mostly compressed already, so they are stored as they are.
  await zip.add(assetEntryName(asset.id, asset.filename), verified, {
    level: 0,
  });
}

/**
 * Writes an environment to a project dump: its schema, every record (current
 * and published versions, with their schedules), upload and folder as JSON
 * lines, and optionally every asset's file.
 */
export async function writeProjectDump(args: {
  client: Client;
  environment: string;
  primary: boolean;
  includeAssets: boolean;
  onProgress?: Progress;
  signal?: AbortSignal;
  entryBytes?: number;
}): Promise<{ blob: Blob; manifest: DumpManifest }> {
  const { client, environment, includeAssets, signal } = args;
  const progress = args.onProgress ?? (() => {});
  const entryBytes = args.entryBytes ?? ENTRY_BYTES;
  // Records fill the progress bar up to here; asset files, the rest.
  const recordShare = includeAssets ? 45 : 90;
  progress(0, 'Reading the schema...');
  const schema = await readSchema(client);
  const models = recordModels(schema);
  await assertFullReadAccess(client, environment, models);
  progress(0, 'Counting records...');
  const total = await countRecords(client, models, signal);
  const zip = new ZipWriter(new BlobWriter('application/zip'), {
    useWebWorkers: false,
  });
  const opened: JsonLines[] = [];
  const jsonLines = (prefix: string) => {
    const lines = new JsonLines(zip, prefix, entryBytes);
    opened.push(lines);
    return lines;
  };
  try {
    await zip.add('schema.json', new TextReader(JSON.stringify(schema)));
    const records = jsonLines('records');
    await writeRecords(
      client,
      models,
      records,
      () => {
        if (records.count % 100 === 0 || records.count === total)
          progress(
            (recordShare * Math.min(records.count, total)) / Math.max(total, 1),
            `Exported ${records.count}/${total} records...`,
          );
      },
      signal,
    );
    await records.end();
    progress(recordShare, 'Reading asset metadata...');
    const uploads = jsonLines('uploads');
    const assets = await writeUploads(client, uploads, signal);
    await uploads.end();
    throwIfAborted(signal);
    const collections = jsonLines('upload-collections');
    for (const collection of await client.uploadCollections.list()) {
      // biome-ignore lint/performance/noAwaitInLoops: Lines are written in order, waiting for the zip to take each.
      await collections.write(collection);
    }
    await collections.end();
    if (includeAssets)
      for (let index = 0; index < assets.length; index++) {
        throwIfAborted(signal);
        progress(
          recordShare + ((95 - recordShare) * index) / assets.length,
          `Downloading asset files: ${index + 1}/${assets.length}...`,
        );
        // biome-ignore lint/performance/noAwaitInLoops: A zip is written one entry at a time.
        await addAssetFile(zip, assets[index], signal);
      }
    throwIfAborted(signal);
    const manifest: DumpManifest = {
      format: FORMAT,
      version: VERSION,
      createdAt: new Date().toISOString(),
      pluginVersion: `datocms-plugin-project-exporter@${PLUGIN_VERSION}`,
      site: { id: schema.site.data.id, environment, primary: args.primary },
      locales: schema.site.data.attributes.locales,
      includesAssets: includeAssets,
      counts: {
        records: records.count,
        uploads: uploads.count,
        uploadCollections: collections.count,
      },
    };
    await zip.add(
      'manifest.json',
      new TextReader(`${JSON.stringify(manifest, null, 2)}\n`),
    );
    progress(95, 'Preparing the dump file...');
    return { blob: await zip.close(), manifest };
  } catch (error) {
    // Like the CLI's discard: zip.js shares its add slots between zips, so an
    // entry left open would hold one for good and later dumps would wait.
    await Promise.all(opened.map((lines) => lines.abort(error)));
    throw error;
  }
}

export default async function downloadProjectDump(
  apiToken: string,
  environment: string,
  baseUrl: string | undefined,
  options: { primary: boolean; includeAssets: boolean },
  onProgress?: Progress,
  signal?: AbortSignal,
): Promise<void> {
  if (!apiToken)
    throw new Error('A user access token is required to export a dump.');
  const filename = dumpFilename(environment, options.includeAssets);
  const { blob, manifest } = await writeProjectDump({
    client: buildClient({ apiToken, environment, baseUrl }),
    environment,
    ...options,
    onProgress,
    signal,
  });
  throwIfAborted(signal);
  await downloadBlob(blob, filename);
  const { records, uploads, uploadCollections } = manifest.counts;
  onProgress?.(
    100,
    `Exported ${records} records, ${uploads} uploads and ${uploadCollections} folders to ${filename}.`,
  );
}
