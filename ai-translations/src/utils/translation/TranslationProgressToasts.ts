/**
 * Duration and recurrence interval for field-translation progress feedback.
 * Keeping these as one value prevents gaps between consecutive progress toasts.
 */
export const TRANSLATION_PROGRESS_TOAST_DURATION_MS = 5_000;

type ProgressToast = {
  type: 'warning';
  message: string;
  dismissOnPageChange: boolean;
  dismissAfterTimeout: number;
};

type ProgressToastDispatcher = (
  toast: ProgressToast,
) => Promise<unknown> | unknown;

/**
 * Shows a progress toast immediately, then replaces it at the same interval as
 * its lifetime until the returned stop function is called.
 */
export function startTranslationProgressToasts(
  dispatchToast: ProgressToastDispatcher,
  buildMessage: (elapsedSeconds: number) => string,
): () => void {
  const startedAt = Date.now();
  let stopped = false;

  const showProgress = () => {
    if (stopped) return;

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
    try {
      void Promise.resolve(
        dispatchToast({
          type: 'warning',
          message: buildMessage(elapsedSeconds),
          dismissOnPageChange: true,
          dismissAfterTimeout: TRANSLATION_PROGRESS_TOAST_DURATION_MS,
        }),
      ).catch(() => undefined);
    } catch {
      // Progress feedback must never interrupt the translation itself.
    }
  };

  showProgress();
  const intervalId = setInterval(
    showProgress,
    TRANSLATION_PROGRESS_TOAST_DURATION_MS,
  );

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}
