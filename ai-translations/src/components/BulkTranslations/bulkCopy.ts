/**
 * bulkCopy.ts
 * -----------
 * Every count and plural string of the bulk translations flow (the bulk page,
 * the records-action picker modal, and the dropdown handler that runs the
 * confirm and progress modals), the shared title and toast constants, and the
 * shared outcome reporter.
 *
 * Every count takes an optional `locale`. A frame or a hook passes
 * `ctx.ui.locale`, the language that the Canvas gives the kit, so the
 * plugin's numbers have the same separators as the kit's own (the page
 * numbers of a pagination, for example). The texts are English, so their
 * plurals are the English ones (singular for exactly one, verbs included).
 * Without a locale, numbers use the runtime's default locale.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string | undefined): Intl.NumberFormat {
  const key = locale ?? '';
  const cached = numberFormats.get(key);
  if (cached) return cached;
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(locale);
  } catch {
    // Not a valid language tag: the default locale still shows the number.
    format = new Intl.NumberFormat();
  }
  numberFormats.set(key, format);
  return format;
}

/** "2,882": a count with the separators of `locale`. */
export function formatCount(count: number, locale?: string): string {
  return numberFormat(locale).format(count);
}

function pluralize(
  count: number,
  singular: string,
  plural: string,
  locale?: string,
): string {
  return count === 1
    ? `${formatCount(1, locale)} ${singular}`
    : `${formatCount(count, locale)} ${plural}`;
}

/** Error of an empty target locale select. */
export const PICK_LOCALE_ERROR = 'Pick at least one locale';
/** Error of the model select, once the user emptied it. */
export const PICK_MODEL_ERROR = 'Pick at least one model';
/** Error of a model's field select with no field picked. */
export const PICK_FIELD_ERROR = 'Pick at least one field';
export const PICKER_MODAL_TITLE = 'Translate records';
export const PROGRESS_MODAL_TITLE = 'Translation progress';
export const TRANSLATION_CANCELED_NOTICE = 'Translation cancelled.';
export const TRANSLATION_FAILED_ALERT = "Couldn't translate the records.";
export const NO_RECORDS_WARNING = 'The selected models have no records.';
/**
 * What a bulk run does to the records, said before it starts: the last line
 * above the button that starts it.
 */
export const BULK_RUN_CONSEQUENCE =
  "This overwrites the content in the locales you translate into, and saves each record as soon as it's translated.";

/**
 * From this many record × target locale translations on, the dialog that
 * starts a run warns about the usage of the vendor.
 */
const LARGE_RUN_THRESHOLD = 10_000;

/** Whether a run is large enough to warn about the usage of the vendor. */
export function isLargeRun(records: number, targetLocales: number): boolean {
  return records * targetLocales >= LARGE_RUN_THRESHOLD;
}

/** The title of the warning of a large run. */
export const LARGE_RUN_TITLE = 'Large translation';

/** The warning of a large run, with the name of the vendor when known. */
export function largeRunWarning(vendorName?: string): string {
  return `This can use a lot of your ${vendorName ?? 'translation'} quota. Keep the progress window open until it finishes.`;
}

/** "1 record" / "2,882 records". */
export function recordCount(count: number, locale?: string): string {
  return pluralize(count, 'record', 'records', locale);
}

/** "1 model" / "2 models". */
export function modelCount(count: number, locale?: string): string {
  return pluralize(count, 'model', 'models', locale);
}

/** "1 locale" / "3 locales". */
export function localeCount(count: number, locale?: string): string {
  return pluralize(count, 'locale', 'locales', locale);
}

/** Submit label: "Translate 12 records". */
export function translateRecordsLabel(count: number, locale?: string): string {
  return `Translate ${recordCount(count, locale)}`;
}

/** Confirm modal title: "Translate 12 records?". */
export function confirmTranslationTitle(
  count: number,
  locale?: string,
): string {
  return `Translate ${recordCount(count, locale)}?`;
}

/** Completion toast: "12 records translated.". */
export function translatedRecordsNotice(
  count: number,
  locale?: string,
): string {
  return `${recordCount(count, locale)} translated.`;
}

/** "1 record was" / "3 records were": a count of records with its verb. */
export function recordCountWas(count: number, locale?: string): string {
  return `${recordCount(count, locale)} ${count === 1 ? 'was' : 'were'}`;
}

/** Field select hint: "5 of 7 translatable fields selected", for a part. */
export function fieldCountHint(
  selected: number,
  total: number,
  locale?: string,
): string {
  return `${formatCount(selected, locale)} of ${formatCount(total, locale)} translatable ${
    total === 1 ? 'field' : 'fields'
  } selected`;
}

/** Live status line while records are being discovered. */
export function discoveryStatus(
  {
    loaded,
    total,
  }: {
    loaded: number;
    total?: number;
  },
  locale?: string,
): string {
  if (total === undefined) {
    return loaded === 0
      ? 'Counting records…'
      : `${recordCount(loaded, locale)} found…`;
  }
  return `${formatCount(loaded, locale)} of ${formatCount(total, locale)} records found`;
}

/**
 * The sentence about the records that a run never reached, by what happened
 * to them: "The translation stopped before the other 2." (or "before the
 * last one."), or, when it is the first sentence, "before translating 12
 * records."
 */
function stoppedSentence(
  notProcessed: number,
  isFirst: boolean,
  locale?: string,
): string {
  let rest = `the other ${formatCount(notProcessed, locale)}`;
  if (isFirst) rest = `translating ${recordCount(notProcessed, locale)}`;
  else if (notProcessed === 1) rest = 'the last one';
  return `The translation stopped before ${rest}.`;
}

type OutcomeToasts = {
  notice(message: string): Promise<void>;
  alert(message: string): Promise<void>;
  customToast(toast: {
    type: 'warning';
    message: string;
    dismissOnPageChange: boolean;
  }): Promise<unknown>;
};

type TranslationOutcome = {
  completed?: boolean;
  canceled?: boolean;
  summary?: {
    totalRecords: number;
    processedCount: number;
    successfulCount: number;
    failedCount: number;
    warningCount: number;
    loadedCount: number;
    updatedCount?: number;
  };
};

/**
 * Reports how a progress-modal run ended. Never awaits the toast, so callers
 * can reset their busy state as soon as the progress modal resolves.
 *
 * @param locale - The user's language (`ctx.ui.locale`), for the separators
 *   of the counts.
 */
export function reportTranslationOutcome(
  ctx: OutcomeToasts,
  result: TranslationOutcome | undefined,
  count: number,
  locale?: string,
): void {
  const summary = result?.summary;
  const records = (n: number) => recordCount(n, locale);
  const num = (n: number) => formatCount(n, locale);
  if (result?.canceled) {
    void ctx.notice(
      summary?.successfulCount
        ? `Translation cancelled. ${recordCountWas(summary.successfulCount, locale)} translated and saved.`
        : TRANSLATION_CANCELED_NOTICE,
    );
  } else if (
    summary &&
    (summary.failedCount > 0 || summary.processedCount < summary.totalRecords)
  ) {
    // One short sentence per count, without the counts of zero. The first
    // one names the records: "8 records translated. 2 failed. The
    // translation stopped before the other 2."
    const notProcessed = summary.totalRecords - summary.processedCount;
    const sentences: string[] = [];
    const add = (n: number, text: string) => {
      if (n === 0) return;
      sentences.push(`${sentences.length === 0 ? records(n) : num(n)} ${text}`);
    };
    add(summary.successfulCount, 'translated.');
    add(summary.failedCount, 'failed.');
    if (notProcessed > 0) {
      sentences.push(
        stoppedSentence(notProcessed, sentences.length === 0, locale),
      );
    }
    void ctx.alert(sentences.join(' '));
  } else if (summary && summary.warningCount > 0) {
    // The progress dialog marks these records amber: a warning, not a success
    void ctx.customToast({
      type: 'warning',
      message: `${records(summary.successfulCount)} translated, ${num(summary.warningCount)} with warnings.`,
      dismissOnPageChange: true,
    });
  } else if (
    summary?.updatedCount !== undefined &&
    summary.updatedCount < summary.successfulCount
  ) {
    const unchanged = summary.successfulCount - summary.updatedCount;
    void ctx.notice(
      `${records(summary.updatedCount)} translated. ${num(unchanged)} had nothing to translate.`,
    );
  } else if (result?.completed)
    void ctx.notice(
      translatedRecordsNotice(summary?.successfulCount ?? count, locale),
    );
  else void ctx.alert(TRANSLATION_FAILED_ALERT);
}
