export type ProgressUpdate = {
  total: number;
  finished: number;
  label?: string;
};

export function createProgressTracker(
  initialTotal: number,
  onUpdate: (update: ProgressUpdate) => void,
  shouldCancel?: () => boolean,
) {
  let finished = 0;
  let lastLabel: string | undefined;
  const checkCancel = () => {
    if (shouldCancel?.()) throw new Error('Operation cancelled');
  };
  const emit = (label?: string) => {
    lastLabel = label ?? lastLabel;
    onUpdate({ total: initialTotal, finished, label: lastLabel });
  };

  const wrap = <TArgs extends unknown[], TResult>(
    labelForArgs: (...args: TArgs) => string,
    fn: (...args: TArgs) => Promise<TResult>,
  ) => {
    return async (...args: TArgs) => {
      try {
        checkCancel();
        emit(labelForArgs(...args));
        const result = await fn(...args);
        checkCancel();
        return result;
      } finally {
        finished += 1;
        emit();
      }
    };
  };

  const tick = (label?: string) => {
    finished += 1;
    emit(label);
  };

  emit();
  return { wrap, tick, checkCancel } as const;
}
