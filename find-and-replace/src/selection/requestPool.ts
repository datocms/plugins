/**
 * The read requests of one search: at most `concurrency` in flight, and at
 * most `perWindow` started in any `windowMs`, first come first served. The
 * CMA allows 60 requests every 3 seconds; a search stays well below that so
 * the rest of the dashboard keeps working while it reads.
 */

export type RequestPoolTimers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type RequestPoolOptions = {
  concurrency: number;
  perWindow: number;
  windowMs: number;
  timers: RequestPoolTimers;
  /** Defaults to `Date.now`. */
  now?: () => number;
};

type Waiter = { start: () => void };

function abortError(): DOMException {
  return new DOMException('The request was cancelled.', 'AbortError');
}

export class RequestPool {
  private active = 0;
  private readonly queue: Waiter[] = [];
  /** Start times inside the current window, oldest first. */
  private readonly starts: number[] = [];
  private timer: unknown = null;

  constructor(private readonly options: RequestPoolOptions) {}

  /**
   * Runs `task` once a slot is free. A task still waiting when `signal`
   * aborts is never started and rejects with an `AbortError`; one already
   * running settles on its own.
   */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError());
      };
      const waiter: Waiter = {
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          this.active += 1;
          this.starts.push(this.now());
          let running: Promise<T>;
          try {
            running = task();
          } catch (error) {
            running = Promise.reject(error);
          }
          running.then(resolve, reject).finally(() => {
            this.active -= 1;
            this.pump();
          });
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
      this.pump();
    });
  }

  /** Requests running now. */
  get inFlight(): number {
    return this.active;
  }

  /** Requests waiting for a slot. */
  get waiting(): number {
    return this.queue.length;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.active < this.options.concurrency) {
      const wait = this.windowWait();
      if (wait > 0) {
        this.wakeAfter(wait);
        return;
      }
      this.queue.shift()?.start();
    }
  }

  /** Milliseconds until the window allows another start (0: now). */
  private windowWait(): number {
    const { perWindow, windowMs } = this.options;
    const now = this.now();
    while (this.starts.length > 0 && now - this.starts[0] >= windowMs) {
      this.starts.shift();
    }
    if (this.starts.length < perWindow) return 0;
    return Math.max(1, this.starts[0] + windowMs - now);
  }

  private wakeAfter(ms: number): void {
    if (this.timer !== null) return;
    this.timer = this.options.timers.setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
  }
}
