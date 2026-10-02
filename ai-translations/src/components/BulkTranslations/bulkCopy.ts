/**
 * bulkCopy.ts
 * -----------
 * Every count and plural string of the bulk translations flow (the bulk page,
 * the records-action picker modal, and the dropdown handler that runs the
 * confirm and progress modals), the shared title and toast constants, and the
 * shared outcome reporter. Counts are formatted with `toLocaleString()`.
 */

const n = (count: number) => count.toLocaleString();

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${n(count)} ${plural}`;
}

export const FIELD_REQUIRED = 'Field is required';
export const PICKER_MODAL_TITLE = 'Translate records';
export const PROGRESS_MODAL_TITLE = 'Translation progress';
export const TRANSLATION_CANCELED_NOTICE = 'Translation successfully canceled!';
export const TRANSLATION_FAILED_ALERT =
  "Couldn't translate some of the records!";
export const NO_RECORDS_WARNING =
  "Couldn't find any records in the selected models!";

/** "1 record" / "2,882 records". */
export function recordCount(count: number): string {
  return pluralize(count, 'record', 'records');
}

/** "1 model" / "2 models". */
export function modelCount(count: number): string {
  return pluralize(count, 'model', 'models');
}

/** "1 target locale" / "3 target locales". */
export function targetLocaleCount(count: number): string {
  return pluralize(count, 'target locale', 'target locales');
}

/** Bulk page toolbar meta: "2 models · 4 target locales". */
export function runSummary(models: number, targetLocales: number): string {
  return `${modelCount(models)} · ${targetLocaleCount(targetLocales)}`;
}

/** Submit label: "Translate 12 records". */
export function translateRecordsLabel(count: number): string {
  return `Translate ${recordCount(count)}`;
}

/** Confirm modal title: "Translate 12 records?". */
export function confirmTranslationTitle(count: number): string {
  return `Translate ${recordCount(count)}?`;
}

/** Completion toast: "One record successfully translated!". */
export function translatedRecordsNotice(count: number): string {
  return count === 1
    ? 'One record successfully translated!'
    : `${n(count)} records successfully translated!`;
}

/** Field select hint: "5 of 7 translatable fields selected". */
export function fieldCountHint(selected: number, total: number): string {
  return `${n(selected)} of ${n(total)} translatable ${
    total === 1 ? 'field' : 'fields'
  } selected`;
}

/** Live status line while records are being discovered. */
export function discoveryStatus({
  loaded,
  total,
}: {
  loaded: number;
  total?: number;
}): string {
  if (total === undefined) {
    return loaded === 0 ? 'Counting records…' : `${recordCount(loaded)} found…`;
  }
  return `${n(loaded)} of ${n(total)} records found`;
}

type OutcomeToasts = {
  notice(message: string): Promise<void>;
  alert(message: string): Promise<void>;
};

type TranslationOutcome = { completed?: boolean; canceled?: boolean };

/**
 * Reports how a progress-modal run ended. Never awaits the toast, so callers
 * can reset their busy state as soon as the progress modal resolves.
 */
export function reportTranslationOutcome(
  ctx: OutcomeToasts,
  result: TranslationOutcome | undefined,
  count: number,
): void {
  if (result?.canceled) void ctx.notice(TRANSLATION_CANCELED_NOTICE);
  else if (result?.completed) void ctx.notice(translatedRecordsNotice(count));
  else void ctx.alert(TRANSLATION_FAILED_ALERT);
}
