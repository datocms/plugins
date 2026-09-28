import { CheckQueue } from '../checking/queue';
import { prepareUrl } from '../checking/url';
import type { ExtractionResult, LinkGroup, ScanReport } from '../types';

export class ScanSession {
  private groups = new Map<string, LinkGroup>();
  private queue: CheckQueue;
  private warnings = new Set<string>();
  private recordsScanned = 0;
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
        const group = this.groups.get(result.key);
        if (group) this.groups.set(result.key, { ...group, result });
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
      const existing = this.groups.get(prepared.key);
      if (existing) {
        this.groups.set(prepared.key, {
          ...existing,
          occurrences: [...existing.occurrences, occurrence],
        });
      } else {
        this.groups.set(prepared.key, {
          key: prepared.key,
          prepared,
          result: { ...prepared },
          occurrences: [occurrence],
          stale: false,
        });
        if (prepared.status === 'queued') this.queue.enqueue(prepared);
      }
    }
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
    if (this.disposed) return;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 80);
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
      groups: [...this.groups.values()],
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
