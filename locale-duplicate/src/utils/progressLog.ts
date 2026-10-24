import type { DuplicationProgress } from '../services/duplicationTypes';

const updateKeys = new WeakMap<DuplicationProgress, number>();
let nextUpdateKey = 0;

/** A stable React key per log entry, also for identical messages and times. */
export function progressUpdateKey(update: DuplicationProgress): number {
  let key = updateKeys.get(update);
  if (key === undefined) {
    key = ++nextUpdateKey;
    updateKeys.set(update, key);
  }
  return key;
}

/** Fixed storage bounds logging work and UI memory during long runs. */
export class ProgressLog {
  private readonly ring: DuplicationProgress[] = [];
  private cursor = 0;
  readonly errors: DuplicationProgress[] = [];
  total = 0;
  totalErrors = 0;

  constructor(
    private readonly limit = 500,
    private readonly errorLimit = 100,
  ) {}

  add(update: DuplicationProgress) {
    const { stats: _stats, ...entry } = update;
    this.total++;
    if (entry.type === 'error') {
      this.totalErrors++;
      if (this.errors.length < this.errorLimit) this.errors.push(entry);
    }
    if (this.ring.length < this.limit) this.ring.push(entry);
    else {
      this.ring[this.cursor] = entry;
      this.cursor = (this.cursor + 1) % this.limit;
    }
  }

  entries(): DuplicationProgress[] {
    return [
      ...this.ring.slice(this.cursor),
      ...this.ring.slice(0, this.cursor),
    ];
  }
}
