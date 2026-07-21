/**
 * A stable per-browser identifier for the bulk-translation run report.
 *
 * The run report's `deviceId` is a tie-break in {@link
 * ../engine/report/recovery!pickLatestRunState} when the same run's checkpoints
 * are gathered from more than one tier. A fresh random id per run (the previous
 * behaviour) made that tie-break meaningless; persisting one id per browser
 * makes cross-session resume deterministic.
 */

/** localStorage key under which the stable device id is persisted. */
export const DEVICE_ID_STORAGE_KEY = 'datocms-plugin-ai-translations.deviceId';

/** A fresh, collision-resistant id. Prefers `crypto.randomUUID`. */
const freshDeviceId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `device-${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;

/** The ambient `localStorage`, or `null` when it is unavailable (SSR, blocked). */
const ambientStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/**
 * Returns the browser's stable device id, generating and persisting one on first
 * use. Any storage failure (private mode, disabled storage) degrades gracefully
 * to an ephemeral id rather than throwing — resume simply won't tie-break across
 * sessions in that case, which is acceptable.
 *
 * @param storage - Storage to read/write; defaults to `localStorage`. Pass a
 *   shim in tests, or `null` to force the ephemeral path.
 */
export const getStableDeviceId = (
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = ambientStorage(),
): string => {
  try {
    const existing = storage?.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const id = freshDeviceId();
    storage?.setItem(DEVICE_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return freshDeviceId();
  }
};
