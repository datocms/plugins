import type { Field } from 'datocms-plugin-sdk';

export const HOST_CONTEXT_FIELD_WAIT_MS = 750;

export function resolveFieldsWithinDeadline({
  fieldsPromise,
  fallbackFields,
  signal,
  waitMs = HOST_CONTEXT_FIELD_WAIT_MS,
}: {
  fieldsPromise: Promise<Field[]>;
  fallbackFields: readonly Field[];
  signal?: AbortSignal;
  waitMs?: number;
}): Promise<Field[]> {
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException('The context load was cancelled.', 'AbortError'),
    );
  }

  return new Promise<Field[]>((resolve, reject) => {
    let settled = false;
    let timeoutId: number | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (fields: readonly Field[]) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve([...fields]);
    };
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new DOMException('The context load was cancelled.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(
      () => finish(fallbackFields),
      Math.max(0, waitMs),
    );
    void fieldsPromise.then(finish, () => finish(fallbackFields));
  });
}
