import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { AvailableFormats } from '../entrypoints/ConfigScreen';
import {
  prepareRecordDownload,
  RecordPartSizeError,
  XLSX_MAX_COLUMNS,
} from './downloadRecordsFile';
import {
  downloadBlob,
  mapWithConcurrency,
  throwIfAborted,
  yieldToBrowser,
} from './exportRuntime';
import { readRecordPage } from './readRecords';
import {
  appendScheduledActions,
  buildRecordExportEnvelope,
  fetchProjectConfigurationExport,
  ReferenceIndexLimitError,
} from './recordExport';

export const RECORDS_PER_PART = 1000;
export const RECORD_PART_INPUT_BYTES = 8 * 1024 * 1024;
export const RECORD_PART_OUTPUT_BYTES = 16 * 1024 * 1024;
export const XLSX_CELLS_PER_PART = 50_000;
export const NESTED_RECORDS_PER_PAGE = 30;
export const PROJECT_METADATA_INPUT_BYTES = 8 * 1024 * 1024;

type Options = { modelIDs?: string[]; textQuery?: string };
type RecordRow = Record<string, unknown>;
type PartInfo = { filename: string; recordCount: number; recordOffset: number };
type Model = Awaited<ReturnType<Client['itemTypes']['list']>>[number];
type Configuration = Awaited<
  ReturnType<typeof fetchProjectConfigurationExport>
>;
type Progress = (progress: number, message: string) => void;

function selectModels(itemTypes: Model[], options: Options): Model[] {
  const selectedIds = options.modelIDs ? new Set(options.modelIDs) : null;
  const availableIds = new Set(itemTypes.map((model) => model.id));
  if (
    selectedIds &&
    Array.from(selectedIds).some((id) => !availableIds.has(id))
  ) {
    throw new Error('One of the selected models no longer exists.');
  }
  return itemTypes.filter(
    (model) =>
      (!selectedIds || selectedIds.has(model.id)) &&
      (!options.textQuery || !model.modular_block),
  );
}

class RecordExportTask {
  private readonly client: Client;
  private readonly exportId = new Date().toISOString().replace(/:/g, '-');
  private readonly parts: PartInfo[] = [];
  private readonly seenIds = new Set<string>();
  private fetchedCount = 0;
  private exportedCount = 0;
  private totalCount = 0;
  private split = false;
  private itemTypes: Model[] = [];
  private fields: RecordRow[] = [];
  private configuration?: Configuration;
  private batch: RecordRow[] = [];
  private batchBytes = 0;
  private batchCells = 0;
  private batchKeys = new Set<string>();

  constructor(
    apiToken: string,
    private readonly environment: string,
    baseUrl: string | undefined,
    private readonly format: AvailableFormats,
    private readonly options: Options,
    private readonly onProgress?: Progress,
    private readonly signal?: AbortSignal,
  ) {
    this.client = buildClient({ apiToken, environment, baseUrl });
  }

  private progress(): number {
    return (
      5 +
      Math.min(1, this.totalCount ? this.fetchedCount / this.totalCount : 0) *
        85
    );
  }

  private filterForModel(id: string) {
    return {
      type: id,
      ...(this.options.textQuery ? { query: this.options.textQuery } : {}),
    };
  }

  private async countModel(id: string): Promise<number> {
    throwIfAborted(this.signal);
    const response = await this.client.items.rawList({
      filter: this.filterForModel(id),
      page: { limit: 0 },
    });
    const count = response.meta.total_count;
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error('The API returned an invalid record count.');
    return count;
  }

  private async initialize(): Promise<{ models: Model[]; counts: number[] }> {
    this.onProgress?.(0, 'Fetching models...');
    this.itemTypes = await this.client.itemTypes.list();
    const models = selectModels(this.itemTypes, this.options);
    this.onProgress?.(1, 'Counting records...');
    const counts = await mapWithConcurrency(models, 4, (model) =>
      this.countModel(model.id),
    );
    this.totalCount = counts.reduce((sum, count) => sum + count, 0);
    this.onProgress?.(
      3,
      `Fetching export metadata for ${this.totalCount} records...`,
    );
    if (this.format === 'JSON') {
      await this.loadFields();
      this.configuration = await fetchProjectConfigurationExport({
        client: this.client,
        itemTypes: this.itemTypes,
        records: [],
        signal: this.signal,
      });
      if (
        new Blob([JSON.stringify(this.configuration.projectConfiguration)])
          .size > PROJECT_METADATA_INPUT_BYTES
      ) {
        throw new Error(
          'Project configuration exceeds the 8 MiB browser export metadata budget.',
        );
      }
    }
    return { models, counts };
  }

  private async loadFields(): Promise<void> {
    let schemaBytes = new Blob([JSON.stringify(this.itemTypes)]).size;
    let completedModels = 0;
    await mapWithConcurrency(this.itemTypes, 4, async (model) => {
      throwIfAborted(this.signal);
      const fields = await this.client.fields.list(model.id);
      schemaBytes += new Blob([JSON.stringify(fields)]).size;
      if (schemaBytes > PROJECT_METADATA_INPUT_BYTES) {
        throw new Error(
          'Project schema exceeds the 8 MiB browser export metadata budget.',
        );
      }
      for (const field of fields) this.fields.push(field);
      completedModels++;
      this.onProgress?.(
        3,
        `Fetching schema for ${completedModels}/${this.itemTypes.length} models; ${this.totalCount} records...`,
      );
    });
  }

  private fetchPage(model: Model, offset: number): Promise<RecordRow[]> {
    throwIfAborted(this.signal);
    return readRecordPage(this.client, {
      nested: true,
      filter: this.filterForModel(model.id),
      order_by: 'id_ASC',
      page: { limit: NESTED_RECORDS_PER_PAGE, offset },
    });
  }

  private async *modelRecords(
    model: Model,
    expectedCount: number,
  ): AsyncGenerator<RecordRow> {
    let offset = 0;
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: Read only one page into memory and consume it before requesting the next.
      const records = await this.fetchPage(model, offset);
      for (const record of records) yield record;
      offset += records.length;
      this.onProgress?.(
        this.progress(),
        `Fetched ${this.fetchedCount}/${this.totalCount} records${this.split ? `; ${this.parts.length} file(s) prepared` : ''}...`,
      );
      await yieldToBrowser();
      if (records.length < NESTED_RECORDS_PER_PAGE) break;
    }
    const finalCount = await this.countModel(model.id);
    if (offset !== expectedCount || finalCount !== expectedCount) {
      throw new Error(
        `Records in model ${model.name} changed during export. Exported files are incomplete.`,
      );
    }
  }

  private validateRecord(record: RecordRow): { bytes: number; keys: string[] } {
    const id = record.id;
    if (typeof id !== 'string' || !id || this.seenIds.has(id)) {
      throw new Error(
        'Duplicate or missing record ID detected; the project may have changed during export.',
      );
    }
    this.seenIds.add(id);
    const bytes = new Blob([JSON.stringify(record)]).size;
    if (bytes > RECORD_PART_INPUT_BYTES) {
      throw new Error(
        `Record ${id} exceeds the 8 MiB per-record browser limit.`,
      );
    }
    return { bytes, keys: Object.keys(record) };
  }

  private exceedsBatchLimit(bytes: number, keys: string[]): boolean {
    if (
      this.batch.length >= RECORDS_PER_PART ||
      this.batchBytes + bytes > RECORD_PART_INPUT_BYTES
    )
      return true;
    if (this.format !== 'XLSX') return false;
    if (this.batchCells + keys.length > XLSX_CELLS_PER_PART) return true;
    const newColumns = keys.filter((key) => !this.batchKeys.has(key)).length;
    return this.batchKeys.size + newColumns > XLSX_MAX_COLUMNS;
  }

  private async addRecord(record: RecordRow): Promise<void> {
    throwIfAborted(this.signal);
    const { bytes, keys } = this.validateRecord(record);
    if (this.batch.length > 0 && this.exceedsBatchLimit(bytes, keys)) {
      this.split = true;
      await this.emitPart(this.batch, false);
      this.batch = [];
      this.batchBytes = 0;
      this.batchCells = 0;
      this.batchKeys.clear();
    }
    this.batch.push(record);
    this.batchBytes += bytes;
    this.batchCells += keys.length;
    for (const key of keys) this.batchKeys.add(key);
    this.fetchedCount++;
  }

  private async preparePart(
    records: RecordRow[],
    isLast: boolean,
  ): Promise<Blob> {
    let data: Parameters<typeof prepareRecordDownload>[0] = records;
    if (this.configuration) {
      const partConfiguration = {
        ...this.configuration.projectConfiguration,
        scheduledPublications: [],
        scheduledUnpublishings: [],
      };
      appendScheduledActions(partConfiguration, records);
      data = buildRecordExportEnvelope({
        records,
        itemTypes: this.itemTypes,
        fields: this.fields,
        siteInfo: {
          ...this.configuration.siteInfo,
          sourceEnvironment: this.environment,
        },
        projectConfiguration: partConfiguration,
        filtersUsed: this.options,
        scope: 'bulk',
        maxReferenceEntries: 50_000,
        partition: {
          exportId: this.exportId,
          index: this.parts.length + 1,
          recordOffset: this.exportedCount,
          isLast,
        },
      });
    }
    this.onProgress?.(
      this.progress(),
      `Preparing ${records.length} records${this.split ? ` for part ${this.parts.length + 1}` : ''}...`,
    );
    const blob = await prepareRecordDownload(data, this.format, {
      signal: this.signal,
      maxBytes: RECORD_PART_OUTPUT_BYTES,
    });
    if (blob.size > RECORD_PART_OUTPUT_BYTES) throw new RecordPartSizeError();
    return blob;
  }

  private async emitPart(records: RecordRow[], isLast: boolean): Promise<void> {
    throwIfAborted(this.signal);
    let blob: Blob;
    try {
      blob = await this.preparePart(records, isLast);
    } catch (error) {
      if (
        !(error instanceof RecordPartSizeError) &&
        !(error instanceof ReferenceIndexLimitError)
      )
        throw error;
      if (records.length <= 1)
        throw new Error(
          'A record and its export metadata exceed the per-file browser limit.',
        );
      this.split = true;
      const middle = Math.ceil(records.length / 2);
      await this.emitPart(records.slice(0, middle), false);
      await this.emitPart(records.slice(middle), isLast);
      return;
    }
    const index = this.parts.length + 1;
    const filename = `allDatocmsRecords${this.split ? `.part-${String(index).padStart(3, '0')}` : ''}.${this.exportId}.${this.format.toLowerCase()}`;
    throwIfAborted(this.signal);
    await downloadBlob(blob, filename);
    this.parts.push({
      filename,
      recordCount: records.length,
      recordOffset: this.exportedCount,
    });
    this.exportedCount += records.length;
    throwIfAborted(this.signal);
    await yieldToBrowser();
  }

  private async downloadManifest(
    status: 'complete' | 'incomplete' | 'cancelled',
  ): Promise<void> {
    const manifest = {
      exportId: this.exportId,
      status,
      sourceEnvironment: this.environment,
      format: this.format,
      totalRecords: this.exportedCount,
      exportedRecords: this.exportedCount,
      expectedRecords: this.totalCount,
      totalParts: this.parts.length,
      parts: this.parts,
      configurationWarnings:
        this.configuration?.projectConfiguration.warnings.length ?? 0,
      consistency:
        'Offset pagination; no transactional snapshot. Avoid editing the project during export.',
    };
    const suffix = status === 'complete' ? 'manifest' : 'incomplete';
    await downloadBlob(
      new Blob([JSON.stringify(manifest, null, 2)], {
        type: 'application/json',
      }),
      `allDatocmsRecords.${this.exportId}.${suffix}.json`,
    );
  }

  private async consumeModels(
    models: Model[],
    counts: number[],
  ): Promise<void> {
    for (let index = 0; index < models.length; index++) {
      // biome-ignore lint/performance/noAwaitInLoops: Complete and release each batch before fetching more records.
      for await (const record of this.modelRecords(
        models[index],
        counts[index],
      )) {
        await this.addRecord(record);
      }
    }
  }

  async run(): Promise<void> {
    try {
      const { models, counts } = await this.initialize();
      await this.consumeModels(models, counts);
      await this.emitPart(this.batch, true);
      if (this.split) await this.downloadManifest('complete');
      const warnings =
        this.configuration?.projectConfiguration.warnings.length ?? 0;
      this.onProgress?.(
        100,
        `Completed export: ${this.exportedCount} records in ${this.parts.length} file(s).${warnings ? ` ${warnings} configuration warning(s) in the JSON manifest.` : ''}`,
      );
    } catch (error) {
      if (this.parts.length > 0)
        await this.downloadManifest(
          this.signal?.aborted ? 'cancelled' : 'incomplete',
        );
      if (this.signal?.aborted) throw error;
      const message =
        error instanceof Error ? error.message : 'Unexpected export error.';
      throw new Error(
        `${message}${this.parts.length ? ` ${this.parts.length} file(s) were prepared before the failure; see the incomplete manifest.` : ''}`,
      );
    }
  }
}

export default async function downloadAllRecords(
  apiToken: string,
  environment: string,
  baseUrl: string | undefined,
  format: AvailableFormats,
  options: Options,
  onProgress?: Progress,
  signal?: AbortSignal,
): Promise<void> {
  if (!apiToken)
    throw new Error('A user access token is required to export records.');
  if (options.modelIDs && options.modelIDs.length === 0)
    throw new Error('Select at least one model to export.');
  await new RecordExportTask(
    apiToken,
    environment,
    baseUrl,
    format,
    options,
    onProgress,
    signal,
  ).run();
}
