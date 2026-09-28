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
type Entry = {
  key: string;
  prepared: PreparedUrl;
  result: CheckResult;
  /** Appended to in place until a report holds it, then copied before it grows. */
  occurrences: LinkOccurrence[];
  /** A report holds `occurrences`. */
  published: boolean;
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
    Math.max(MIN_FLUSH_DELAY_MS, Math.round(size / 1_000)),
  );
}

function snapshot(entry: Entry): LinkGroup {
  if (!entry.published) {
    if (entry.facts) cacheGroupFacts(entry.occurrences, entry.facts.facts());
    entry.published = true;
  }
  entry.group ??= {
    key: entry.key,
    prepared: entry.prepared,
    result: entry.result,
    occurrences: entry.occurrences,
    stale: false,
  };
  return entry.group;
}

export class ScanSession {
  private entries = new Map<string, Entry>();
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
    for (const occurrence of extraction.occurrences) {
      const prepared = prepareUrl(occurrence.url);
      const existing = this.entries.get(prepared.key);
      if (existing) {
        if (existing.published) {
          existing.occurrences = existing.occurrences.slice();
          existing.published = false;
        }
        if (!existing.facts) {
          existing.facts = new GroupFactsBuilder();
          for (const earlier of existing.occurrences)
            existing.facts.add(earlier);
        }
        existing.occurrences.push(occurrence);
        existing.facts.add(occurrence);
        existing.group = undefined;
      } else {
        this.entries.set(prepared.key, {
          key: prepared.key,
          prepared,
          result: { ...prepared },
          occurrences: [occurrence],
          published: false,
        });
        if (prepared.status === 'queued') this.queue.enqueue(prepared);
      }
    }
    this.occurrenceCount += extraction.occurrences.length;
    this.schedule();
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
      groups: Array.from(this.entries.values(), snapshot),
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
