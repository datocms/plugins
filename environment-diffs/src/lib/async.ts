import type { CompareTaskSignal } from '../types';

export class CompareTaskCancelledError extends Error {
  constructor() {
    super('Compare task cancelled');
  }
}

export function createCompareTaskController() {
  const signal: CompareTaskSignal = {
    cancelled: false,
  };

  return {
    signal,
    cancel() {
      signal.cancelled = true;
    },
  };
}

export function throwIfCancelled(signal: CompareTaskSignal) {
  if (signal.cancelled) {
    throw new CompareTaskCancelledError();
  }
}

export async function yieldToMainThread() {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
