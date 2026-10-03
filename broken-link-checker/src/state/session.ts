import { CheckQueue } from '../checking/queue';
import { prepareUrl } from '../checking/url';
import { cacheGroupFacts, GroupFactsBuilder } from '../report/view';
import type {
  CheckResult,
  ExtractionResult,
  LinkGroup,
  LinkOccurrence,
  PreparedUrl,
  ScanReport,
} from '../types';

/** A URL as the session collects it; reports get snapshots of it. */
type OccurrenceStore = {
  values: LinkOccurrence[];
  sealed: boolean;
};

type Entry = {
  key: string;
  prepared: PreparedUrl;
  result: CheckResult;
  /** Append-only while reading. Reports capture a length without copying the entire history. */
  occurrences: OccurrenceStore;
  occurrenceSnapshot?: () => LinkOccurrence[];
  stale: boolean;
  /**
   * Only for URLs found more than once: a report reads the facts of a URL
   * found once as cheaply as it would read them here.
   */
  facts?: GroupFactsBuilder;
  /** The last snapshot, reused until the entry changes. */
  group?: LinkGroup;
};

const MIN_FLUSH_DELAY_MS = 80;
const MAX_FLUSH_DELAY_MS = 2_000;

/**
 * How long to wait before publishing the next report. Every report is filtered,
 * counted and rendered in full, so a large one is published less often.
 */
export function flushDelay(size: number): number {
  return Math.min(
    MAX_FLUSH_DELAY_MS,
    Math.max(MIN_FLUSH_DELAY_MS, Math.round(size / 250)),
  );
}

function snapshot(entry: Entry, sealed: boolean): LinkGroup {
  entry.occurrences.sealed = sealed;
  if (!entry.occurrenceSnapshot) {
    const store = entry.occurrences;
    const length = store.values.length;
    let values: LinkOccurrence[] | undefined;
    // Most reports only read the collected facts. Copy locations only when a
    // detail view, combined filter or export actually asks for that snapshot.
    entry.occurrenceSnapshot = () => {
      values ??=
        store.sealed && length === store.values.length
          ? store.values
          : store.values.slice(0, length);
      return values;
    };
  }
  const readOccurrences = entry.occurrenceSnapshot;
  entry.group ??= {
    key: entry.key,
    prepared: entry.prepared,
    result: entry.result,
    get occurrences() {
      return readOccurrences();
    },
    stale: entry.stale,
  };
  if (entry.facts) cacheGroupFacts(entry.group, entry.facts.facts());
  return entry.group;
}

const PREPARED_CACHE_SIZE = 2_048;

export class ScanSession {
  private entries = new Map<string, Entry>();
  private preparedCache = new Map<string, PreparedUrl>();
  private queue: CheckQueue;
  private warnings = new Set<string>();
  private recordsScanned = 0;
  private occurrenceCount = 0;
  private discovering = true;
  private state: ScanReport['state'] = 'running';
  private startedAt = new Date().toISOString();
  private finishedAt?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private finishing?: Promise<void>;
  private staleRecords = new Set<string>();
  private allStale = false;

  constructor(
    private scope: string,
    private signal: AbortSignal,
    private onChange: (report: ScanReport) => void,
  ) {
    this.queue = new CheckQueue({
      signal,
      onResult: (result) => {
        if (this.disposed) return;
        const entry = this.entries.get(result.key);
        if (entry) {
          entry.result = result;
          entry.group = undefined;
        }
        this.schedule();
      },
    });
  }

  addRecord(extraction: ExtractionResult) {
    if (this.signal.aborted || this.disposed || !this.discovering) return;
    this.recordsScanned += 1;
    for (const warning of extraction.warnings) this.warnings.add(warning);
    for (const occurrence of extraction.occurrences)
      this.addOccurrence(occurrence);
    this.occurrenceCount += extraction.occurrences.length;
    this.schedule();
  }

  private addOccurrence(occurrence: LinkOccurrence): void {
    const prepared = this.prepare(occurrence.url);
    const existing = this.entries.get(prepared.key);
    if (!existing) {
      this.entries.set(prepared.key, {
        key: prepared.key,
        prepared,
        result: { ...prepared },
        occurrences: { values: [occurrence], sealed: false },
        stale: this.isStale(occurrence.recordId),
      });
      if (prepared.status === 'queued') this.queue.enqueue(prepared);
      return;
    }
    if (!existing.facts) {
      existing.facts = new GroupFactsBuilder();
      for (const earlier of existing.occurrences.values)
        existing.facts.add(earlier);
    }
    existing.occurrences.values.push(occurrence);
    existing.occurrenceSnapshot = undefined;
    existing.stale ||= this.isStale(occurrence.recordId);
    existing.facts.add(occurrence);
    existing.group = undefined;
  }

  private prepare(url: string): PreparedUrl {
    let prepared = this.preparedCache.get(url);
    if (prepared) this.preparedCache.delete(url);
    else prepared = prepareUrl(url);
    this.preparedCache.set(url, prepared);
    if (this.preparedCache.size > PREPARED_CACHE_SIZE) {
      const oldest = this.preparedCache.keys().next().value;
      if (oldest !== undefined) this.preparedCache.delete(oldest);
    }
    return prepared;
  }

  /** Automatic backpressure; the scan continues as network workers free space. */
  waitForCapacity(limit?: number): Promise<void> {
    return this.queue.waitForCapacity(limit);
  }

  private isStale(recordId?: string): boolean {
    return this.allStale || (!!recordId && this.staleRecords.has(recordId));
  }

  markStale(recordId?: string): void {
    if (this.disposed) return;
    if (recordId) this.staleRecords.add(recordId);
    else this.allStale = true;
    for (const entry of this.entries.values()) {
      if (
        !entry.stale &&
        (!recordId ||
          entry.occurrences.values.some(
            (occurrence) => occurrence.recordId === recordId,
          ))
      ) {
        entry.stale = true;
        entry.group = undefined;
      }
    }
    this.flush();
  }

  warn(message: string) {
    if (this.signal.aborted || this.disposed || !this.discovering) return;
    this.warnings.add(message);
    this.schedule();
  }

  finish(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishing ??= this.finalize();
    return this.finishing;
  }

  private async finalize() {
    this.discovering = false;
    this.flush();
    await this.queue.drain();
    this.state = this.signal.aborted
      ? 'cancelled'
      : this.warnings.size > 0
        ? 'partial'
        : 'complete';
    this.finishedAt = new Date().toISOString();
    this.flush();
  }

  private schedule() {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(
      () => this.flush(),
      flushDelay(this.occurrenceCount + this.entries.size),
    );
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed) return;
    this.onChange({
      state: this.state,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      recordsScanned: this.recordsScanned,
      discovering: this.discovering,
      groups: Array.from(this.entries.values(), (entry) =>
        snapshot(entry, !this.discovering),
      ),
      warnings: [...this.warnings],
      scope: this.scope,
    });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The content could not be read.';
}
