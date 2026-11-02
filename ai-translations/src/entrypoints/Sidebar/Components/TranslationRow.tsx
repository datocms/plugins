/**
 * TranslationRow.tsx
 * ------------------
 * One field of a whole-record translation in the sidebar panel: the field
 * label, and under it the state of the field in all its target locales (an
 * inline spinner while it is translated, then a dot before the result, which
 * names the locales that failed: amber when some were translated). A click
 * on the row scrolls the form to the field, in the first locale that failed
 * when one did.
 */
import EntityRow from 'datocms-react-ui/EntityRow';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import { type ReactNode, useEffect, useState } from 'react';
import { PENDING_HINT_THRESHOLD_SECONDS } from '../../../utils/constants';
import { formatList, formatLocaleWithCode } from '../../../utils/localeUtils';

export type TranslationRowStatus = 'pending' | 'done' | 'error';

/** One field in one target locale of the run, as the run reports it. */
export type TranslationRowState = {
  /** The path of the field in the target locale, unique per row ("title.it"). */
  id: string;
  fieldLabel: string;
  /** The target locale of the row. */
  locale: string;
  /** The path of the field without its locale, for `ctx.scrollToField`. */
  baseFieldPath: string;
  status: TranslationRowStatus;
};

/** One field of the run, with its state in each target locale. */
export type FieldRowState = {
  fieldLabel: string;
  /** The path of the field without its locale, unique per field. */
  baseFieldPath: string;
  /** Every target locale of the run, in order, with its state. */
  locales: { locale: string; status: TranslationRowStatus }[];
};

/**
 * The fields of the run, in the order they started, each with every target
 * locale of the run. A locale that hasn't started yet is pending while the
 * run goes on, and failed once it ended.
 */
export function fieldRows(
  rows: TranslationRowState[],
  targetLocales: string[],
  runEnded: boolean,
): FieldRowState[] {
  const fields = new Map<
    string,
    { fieldLabel: string; statuses: Map<string, TranslationRowStatus> }
  >();
  for (const row of rows) {
    let field = fields.get(row.baseFieldPath);
    if (!field) {
      field = { fieldLabel: row.fieldLabel, statuses: new Map() };
      fields.set(row.baseFieldPath, field);
    }
    field.statuses.set(row.locale, row.status);
  }
  const missing: TranslationRowStatus = runEnded ? 'error' : 'pending';
  return [...fields].map(([baseFieldPath, field]) => ({
    fieldLabel: field.fieldLabel,
    baseFieldPath,
    locales: targetLocales.map((locale) => ({
      locale,
      status: field.statuses.get(locale) ?? missing,
    })),
  }));
}

/** The state of the whole field: pending until every locale settled. */
function fieldStatus(field: FieldRowState): TranslationRowStatus {
  const statuses = field.locales.map((entry) => entry.status);
  if (statuses.includes('pending')) return 'pending';
  return statuses.includes('error') ? 'error' : 'done';
}

/** The locale that a click opens: the first that failed, else the first. */
export function localeToOpen(field: FieldRowState): string | undefined {
  return (
    field.locales.find((entry) => entry.status === 'error')?.locale ??
    field.locales[0]?.locale
  );
}

type Props = {
  field: FieldRowState;
  onOpen: (field: FieldRowState) => void;
};

/**
 * True once the field has been translating for
 * PENDING_HINT_THRESHOLD_SECONDS, so a large field reads as slow rather than
 * stuck.
 */
function useIsSlow(status: TranslationRowStatus): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setTimeout(
      () => setSlow(true),
      PENDING_HINT_THRESHOLD_SECONDS * 1000,
    );
    return () => clearTimeout(timer);
  }, [status]);

  return slow && status === 'pending';
}

/**
 * The mark before the state: a spinner while it runs, then a dot. A field
 * translated into some of its locales is amber, as a partly translated
 * record of the progress modal; red is for a field that wasn't translated.
 */
function stateMark(
  field: FieldRowState,
  status: TranslationRowStatus,
): ReactNode {
  if (status === 'pending') return <Spinner inline label={false} />;
  if (status === 'done') return <FeedbackDot tone="success" />;
  const someDone = field.locales.some((entry) => entry.status === 'done');
  return <FeedbackDot tone={someDone ? 'warning' : 'danger'} />;
}

/**
 * The state of the field in words: "Translating into 3 locales…",
 * "Translated into 3 locales", "Translated into 2 of 3 locales. German [de]
 * failed." A run into one locale names it.
 */
function stateText(
  field: FieldRowState,
  status: TranslationRowStatus,
  slow: boolean,
): string {
  const total = field.locales.length;
  const only = field.locales[0];
  const into =
    total === 1 && only
      ? `into ${formatLocaleWithCode(only.locale)}`
      : `into ${total} locales`;
  if (status === 'pending') {
    return slow ? 'Still translating a large field…' : `Translating ${into}…`;
  }
  if (status === 'done') return `Translated ${into}`;
  const failed = field.locales
    .filter((entry) => entry.status === 'error')
    .map((entry) => formatLocaleWithCode(entry.locale));
  const translated = total - failed.length;
  if (translated === 0) return 'Failed';
  return `Translated into ${translated} of ${total} locales. ${formatList(failed)} failed.`;
}

/**
 * A field of the running translation. It is a button: its name is the field
 * label and its state, as they show.
 */
export function TranslationRow({ field, onOpen }: Props) {
  const status = fieldStatus(field);
  const slow = useIsSlow(status);

  return (
    <RowList.Item onClick={() => onOpen(field)}>
      <EntityRow layout="row" title={field.fieldLabel}>
        {stateMark(field, status)} {stateText(field, status, slow)}
      </EntityRow>
    </RowList.Item>
  );
}
