import type { CheckResult, PreparedUrl } from '../types';
import { checkUrl } from './client';

export type QueueOptions = {
  signal: AbortSignal;
  onResult: (result: CheckResult) => void;
  check?: (prepared: PreparedUrl, signal: AbortSignal) => Promise<CheckResult>;
};

export class CheckQueue {
  private readonly options: QueueOptions;
  private readonly seen = new Set<string>();
  private readonly hosts = new Set<string>();
  private readonly pending: PreparedUrl[] = [];
  private readonly waiters = new Set<() => void>();
  private active = 0;
  private listening = false;

  constructor(options: QueueOptions) {
    this.options = options;
  }

  enqueue(prepared: PreparedUrl): void {
    if (this.seen.has(prepared.key)) return;
    this.seen.add(prepared.key);

    if (this.options.signal.aborted) {
      this.emit(this.cancelled(prepared));
      return;
    }
    if (prepared.status !== 'queued') {
      this.emit({
        key: prepared.key,
        url: prepared.url,
        status: prepared.status,
        message: prepared.message,
      });
      return;
    }

    this.pending.push(prepared);
    if (!this.listening) {
      this.options.signal.addEventListener('abort', this.onAbort, {
        once: true,
      });
      this.listening = true;
    }
    this.pump();
  }

  drain(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0)
      return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  private cancelled(prepared: PreparedUrl): CheckResult {
    return {
      key: prepared.key,
      url: prepared.url,
      status: 'cancelled',
      message: 'The link check was cancelled.',
    };
  }

  private emit(result: CheckResult): void {
    try {
      this.options.onResult(result);
    } catch {
      // A consumer callback must not leave the worker queue permanently busy.
    }
  }

  private readonly onAbort = (): void => {
    for (const prepared of this.pending.splice(0)) {
      this.emit(this.cancelled(prepared));
    }
    this.finishDrain();
  };

  private pump(): void {
    if (this.options.signal.aborted) {
      this.onAbort();
      return;
    }
    while (this.active < 4) {
      const index = this.pending.findIndex(
        (prepared) => !this.hosts.has(prepared.hostname ?? ''),
      );
      if (index < 0) break;
      const [prepared] = this.pending.splice(index, 1);
      const host = prepared.hostname ?? '';
      this.active += 1;
      this.hosts.add(host);
      this.emit({
        key: prepared.key,
        url: prepared.url,
        status: 'checking',
        message: 'Checking this URL.',
      });
      void this.run(prepared).finally(() => {
        this.active -= 1;
        this.hosts.delete(host);
        this.pump();
        this.finishDrain();
      });
    }
    this.finishDrain();
  }

  private async run(prepared: PreparedUrl): Promise<void> {
    const { signal } = this.options;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<CheckResult>((resolve) => {
      onAbort = () => resolve(this.cancelled(prepared));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) return this.cancelled(prepared);
          return (this.options.check ?? checkUrl)(prepared, signal);
        }),
        aborted,
      ]);
      this.emit(signal.aborted ? this.cancelled(prepared) : result);
    } catch {
      this.emit(
        signal.aborted
          ? this.cancelled(prepared)
          : {
              key: prepared.key,
              url: prepared.url,
              status: 'unverified',
              message: 'The request failed. The link could not be verified.',
            },
      );
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private finishDrain(): void {
    if (this.active !== 0 || this.pending.length !== 0) return;
    if (this.listening) {
      this.options.signal.removeEventListener('abort', this.onAbort);
      this.listening = false;
    }
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}
