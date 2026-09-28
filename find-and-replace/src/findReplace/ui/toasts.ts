import type { RenderPageCtx, Toast } from 'datocms-plugin-sdk';
import type { FindReplaceEvent } from '../contract';
import { type Copy, STRINGS } from './copy';

export type RunEndedEvent = Extract<FindReplaceEvent, { type: 'runEnded' }>;
export type PublishEndedEvent = Extract<
  FindReplaceEvent,
  { type: 'publishEnded' }
>;

/** What a toast's button asks the page to do. */
export type RunToastCta = 'searchAgain' | 'retry';

export type RunToast =
  | { kind: 'notice'; message: string }
  | { kind: 'alert'; message: string }
  | { kind: 'custom'; toast: Toast<RunToastCta> };

type ToastCtx = Pick<RenderPageCtx, 'notice' | 'alert' | 'customToast'>;

const SEARCH_AGAIN = {
  label: STRINGS.searchAgain,
  value: 'searchAgain',
} as const;
const TRY_AGAIN = { label: STRINGS.tryAgain, value: 'retry' } as const;

function custom(
  type: Toast['type'],
  message: string,
  cta?: Toast<RunToastCta>['cta'],
): RunToast {
  return {
    kind: 'custom',
    toast: cta
      ? { type, message, cta, dismissOnPageChange: true }
      : { type, message, dismissOnPageChange: true },
  };
}

/** The one toast for a pass that just ended (from `pass`, never the session totals). */
export function runToast(event: RunEndedEvent, copy: Copy): RunToast {
  const { pass, verb } = event;

  if (event.stopped) {
    return custom('warning', copy.toastStopped(pass));
  }
  if (event.allFailedCause === 'permission') {
    return { kind: 'alert', message: copy.toastPermission(verb) };
  }

  const skipped = pass.skippedRecords > 0;
  const failed = pass.failedRecords > 0;

  if (!skipped && !failed) {
    return { kind: 'notice', message: copy.toastAllWritten(pass, verb) };
  }
  if (!failed) {
    return custom('warning', copy.toastSkipped(pass, verb), SEARCH_AGAIN);
  }

  const retry = pass.retryableFailedRecords > 0 ? TRY_AGAIN : undefined;

  if (!skipped) {
    return custom('alert', copy.toastFailed(pass, verb), retry);
  }
  return custom(
    'alert',
    copy.toastNotUpdated(pass, verb),
    retry ?? SEARCH_AGAIN,
  );
}

/** The one toast for a publish pass that just ended. */
export function publishToast(event: PublishEndedEvent, copy: Copy): RunToast {
  const { pass } = event;

  if (event.stopped) {
    return custom('warning', copy.toastPublishStopped(pass));
  }
  if (event.allFailedCause === 'permission') {
    return { kind: 'alert', message: copy.toastPublishPermission() };
  }
  if (pass.skipped === 0 && pass.failed === 0) {
    return { kind: 'notice', message: copy.toastPublished(pass) };
  }
  return custom(
    pass.failed > 0 ? 'alert' : 'warning',
    copy.toastPublishPartial(pass),
  );
}

/**
 * Shows the toast without waiting for it. Resolves with the CTA the user
 * clicked, or null (no CTA, dismissed, or the host call failed).
 */
export function showRunToast(
  ctx: ToastCtx,
  toast: RunToast,
): Promise<RunToastCta | null> {
  switch (toast.kind) {
    case 'notice':
      return Promise.resolve(ctx.notice(toast.message)).then(
        () => null,
        () => null,
      );
    case 'alert':
      return Promise.resolve(ctx.alert(toast.message)).then(
        () => null,
        () => null,
      );
    case 'custom':
      return Promise.resolve(ctx.customToast<RunToastCta>(toast.toast)).then(
        (value) => value ?? null,
        () => null,
      );
  }
}
