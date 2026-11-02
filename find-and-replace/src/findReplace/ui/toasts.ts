import type { RenderPageCtx, Toast } from 'datocms-plugin-sdk';
import type { FindReplaceEvent } from '../contract';
import type { Copy } from './copy';

export type RunEndedEvent = Extract<FindReplaceEvent, { type: 'runEnded' }>;
export type PublishEndedEvent = Extract<
  FindReplaceEvent,
  { type: 'publishEnded' }
>;

export type RunToast =
  | { kind: 'notice'; message: string }
  | { kind: 'alert'; message: string }
  | { kind: 'custom'; toast: Toast };

type ToastCtx = Pick<RenderPageCtx, 'notice' | 'alert' | 'customToast'>;

/**
 * A toast without a button: the title bar holds "Search again" and the
 * retries whenever no pass runs.
 */
function custom(type: Toast['type'], message: string): RunToast {
  return {
    kind: 'custom',
    toast: { type, message, dismissOnPageChange: true },
  };
}

/**
 * The one toast for a pass that just ended (from `pass`, never the session
 * totals), in the words of the meta after the title.
 */
export function runToast(event: RunEndedEvent, copy: Copy): RunToast {
  const { pass, verb } = event;

  if (event.stopped) {
    return custom('warning', copy.toastStopped(pass, verb));
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
    return custom('warning', copy.toastSkipped(pass, verb));
  }
  if (!skipped) {
    return custom('alert', copy.toastFailed(pass, verb));
  }
  return custom('alert', copy.toastNotUpdated(pass, verb));
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

/** Shows the toast without waiting for it; a host call that fails is ignored. */
export function showRunToast(ctx: ToastCtx, toast: RunToast): Promise<void> {
  const settled = () => {};
  switch (toast.kind) {
    case 'notice':
      return Promise.resolve(ctx.notice(toast.message)).then(settled, settled);
    case 'alert':
      return Promise.resolve(ctx.alert(toast.message)).then(settled, settled);
    case 'custom':
      return Promise.resolve(ctx.customToast(toast.toast)).then(
        settled,
        settled,
      );
  }
}
