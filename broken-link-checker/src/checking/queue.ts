import type { CheckResult, PreparedUrl } from '../types';
import { type CheckOptions, checkUrl } from './client';

export type QueueOptions = {
  signal: AbortSignal;
  onResult: (result: CheckResult) => void;
  check?: (
    prepared: PreparedUrl,
    signal: AbortSignal,
    options?: CheckOptions,
  ) => Promise<CheckResult>;
};

/** Constant amortized dequeue cost; consumed entries no longer retain URLs. */
class Fifo<T> {
  private values: (T | undefined)[] = [];
  private offset = 0;

  get length(): number {
    return this.values.length - this.offset;
  }

  push(value: T): void {
    this.values.push(value);
  }

  shift(): T | undefined {
    if (this.length === 0) return undefined;
    const value = this.values[this.offset];
    this.values[this.offset] = undefined;
    this.offset += 1;
    if (this.offset >= 1_024 && this.offset * 2 >= this.values.length) {
      this.values = this.values.slice(this.offset);
      this.offset = 0;
    }
    return value;
  }

  clear(): void {
    this.values = [];
    this.offset = 0;
  }
}

type HostQueue = {
  hostname: string;
  pending: Fifo<PreparedUrl>;
  active: boolean;
};

type WaitingHost = { host: HostQueue; until: number };

/** A single timer serves all delayed hosts without repeatedly scanning every deadline. */
class CooldownHeap {
  private values: WaitingHost[] = [];

  get first(): WaitingHost | undefined {
    return this.values[0];
  }

  push(value: WaitingHost): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.values[parentIndex];
      if (parent.until <= value.until) break;
      this.values[index] = parent;
      index = parentIndex;
    }
    this.values[index] = value;
  }

  shift(): WaitingHost | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!last || this.values.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child =
        right < this.values.length &&
        this.values[right].until < this.values[left].until
          ? right
          : left;
      if (last.until <= this.values[child].until) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }

  clear(): void {
    this.values = [];
  }

  takeAll(): WaitingHost[] {
    const values = this.values;
    this.values = [];
    return values;
  }
}

const CONCURRENCY = 4;
const WORK_BEFORE_YIELD = 256;
const MAX_HOST_WAIT_MS = 30_000;

export class CheckQueue {
  private readonly options: QueueOptions;
  private readonly seen = new Set<string>();
  private readonly hosts = new Map<string, HostQueue>();
  private readonly ready = new Fifo<HostQueue>();
  private readonly waiting = new CooldownHeap();
  private readonly cooldowns = new Map<
    string,
    { until: number; httpStatus: number; wait: boolean }
  >();
  private readonly waiters = new Set<() => void>();
  private readonly capacityWaiters = new Set<{
    limit: number;
    resolve: () => void;
  }>();
  private pendingCount = 0;
  private active = 0;
  private listening = false;
  private launchesSinceYield = 0;
  private yieldTimer: ReturnType<typeof setTimeout> | undefined;
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private cooldownWakeAt: number | undefined;
  private proxyRefused = false;

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

    const hostname = (prepared.hostname ?? '').replace(/\.$/, '');
    let host = this.hosts.get(hostname);
    if (!host) {
      host = { hostname, pending: new Fifo(), active: false };
      this.hosts.set(hostname, host);
    }
    if (!host.active && host.pending.length === 0) this.ready.push(host);
    host.pending.push(prepared);
    this.pendingCount += 1;
    if (!this.listening) {
      this.options.signal.addEventListener('abort', this.onAbort, {
        once: true,
      });
      this.listening = true;
    }
    this.pump();
  }

  drain(): Promise<void> {
    if (this.active === 0 && this.pendingCount === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  /** Continuous backpressure for record discovery, without retaining an unlimited URL backlog. */
  waitForCapacity(limit = 1_000): Promise<void> {
    const threshold = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : 1_000;
    if (this.options.signal.aborted || this.pendingCount < threshold)
      return Promise.resolve();
    return new Promise((resolve) =>
      this.capacityWaiters.add({ limit: threshold, resolve }),
    );
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
    clearTimeout(this.yieldTimer);
    clearTimeout(this.cooldownTimer);
    this.yieldTimer = undefined;
    this.cooldownTimer = undefined;
    this.cooldownWakeAt = undefined;
    this.ready.clear();
    this.waiting.clear();
    this.cooldowns.clear();
    for (const host of this.hosts.values()) {
      let prepared = host.pending.shift();
      while (prepared) {
        this.pendingCount -= 1;
        this.emit(this.cancelled(prepared));
        prepared = host.pending.shift();
      }
      host.pending.clear();
      if (!host.active) this.hosts.delete(host.hostname);
    }
    this.finishCapacity();
    this.finishDrain();
  };

  private pump(): void {
    if (this.options.signal.aborted) {
      this.onAbort();
      return;
    }
    if (this.yieldTimer !== undefined) return;
    while (this.active < CONCURRENCY && this.ready.length > 0) {
      if (this.launchesSinceYield >= WORK_BEFORE_YIELD) {
        this.yieldTimer = setTimeout(() => {
          this.yieldTimer = undefined;
          this.launchesSinceYield = 0;
          this.pump();
        }, 0);
        break;
      }
      const host = this.ready.shift();
      if (!host) continue;
      this.launchesSinceYield += 1;
      if (this.waitForCooldown(host)) continue;
      const prepared = host.pending.shift();
      if (!prepared) continue;
      this.pendingCount -= 1;
      if (
        this.skipRefusedProxy(prepared, host) ||
        this.skipCoolingDown(prepared, host)
      )
        continue;
      this.active += 1;
      host.active = true;
      this.emit({
        key: prepared.key,
        url: prepared.url,
        status: 'checking',
        message: 'Checking this URL.',
      });
      void this.run(prepared, host.hostname).finally(() => {
        this.active -= 1;
        this.releaseHost(host);
        this.pump();
        this.finishDrain();
      });
    }
    this.finishCapacity();
    this.finishDrain();
  }

  private refuseProxy(): void {
    if (this.proxyRefused) return;
    this.proxyRefused = true;
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = undefined;
    this.cooldownWakeAt = undefined;
    for (const waiting of this.waiting.takeAll()) this.ready.push(waiting.host);
    this.cooldowns.clear();
  }

  private skipRefusedProxy(prepared: PreparedUrl, host: HostQueue): boolean {
    if (!this.proxyRefused) return false;
    this.releaseHost(host);
    this.emit({
      key: prepared.key,
      url: prepared.url,
      status: 'unverified',
      reason: 'proxy-refused',
      message:
        "The link checking service refused this plugin's address. This URL was not requested.",
    });
    return true;
  }

  private waitForCooldown(host: HostQueue): boolean {
    if (this.proxyRefused) return false;
    const cooldown = this.cooldowns.get(host.hostname);
    if (!cooldown?.wait || cooldown.until <= Date.now()) return false;
    this.waiting.push({ host, until: cooldown.until });
    this.scheduleCooldownWake();
    return true;
  }

  private scheduleCooldownWake(): void {
    const first = this.waiting.first;
    if (!first || first.until === this.cooldownWakeAt) return;
    clearTimeout(this.cooldownTimer);
    this.cooldownWakeAt = first.until;
    this.cooldownTimer = setTimeout(
      this.wakeCooldowns,
      Math.max(0, first.until - Date.now()),
    );
  }

  private readonly wakeCooldowns = (): void => {
    this.cooldownTimer = undefined;
    this.cooldownWakeAt = undefined;
    if (this.options.signal.aborted) return;
    const now = Date.now();
    while (this.waiting.first && this.waiting.first.until <= now) {
      const waiting = this.waiting.shift();
      if (waiting) this.ready.push(waiting.host);
    }
    this.scheduleCooldownWake();
    this.pump();
  };

  private releaseHost(host: HostQueue): void {
    host.active = false;
    if (host.pending.length > 0) this.ready.push(host);
    else this.hosts.delete(host.hostname);
  }

  private skipCoolingDown(prepared: PreparedUrl, host: HostQueue): boolean {
    const cooldown = this.cooldowns.get(host.hostname);
    if (!cooldown) return false;
    if (cooldown.until <= Date.now()) {
      this.cooldowns.delete(host.hostname);
      return false;
    }
    this.releaseHost(host);
    const rateLimited = cooldown.httpStatus === 429;
    this.emit({
      key: prepared.key,
      url: prepared.url,
      status: rateLimited ? 'blocked' : 'unverified',
      reason: rateLimited ? 'rate-limited' : 'server-error',
      message:
        'The site asked automated requests to wait. This URL was not requested during its waiting period.',
    });
    return true;
  }

  private async run(prepared: PreparedUrl, hostname: string): Promise<void> {
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
          return (this.options.check ?? checkUrl)(prepared, signal, {
            onBackoff: (cooldown) => {
              if (signal.aborted || this.proxyRefused) return;
              const previous = this.cooldowns.get(hostname);
              if (!previous || cooldown.until > previous.until)
                this.cooldowns.set(hostname, {
                  ...cooldown,
                  wait: cooldown.until - Date.now() <= MAX_HOST_WAIT_MS,
                });
            },
          });
        }),
        aborted,
      ]);
      if (!signal.aborted && result.reason === 'proxy-refused')
        this.refuseProxy();
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
    if (this.active !== 0 || this.pendingCount !== 0) return;
    this.launchesSinceYield = 0;
    if (this.listening) {
      this.options.signal.removeEventListener('abort', this.onAbort);
      this.listening = false;
    }
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  private finishCapacity(): void {
    for (const waiter of this.capacityWaiters) {
      if (!this.options.signal.aborted && this.pendingCount >= waiter.limit)
        continue;
      this.capacityWaiters.delete(waiter);
      waiter.resolve();
    }
  }
}
