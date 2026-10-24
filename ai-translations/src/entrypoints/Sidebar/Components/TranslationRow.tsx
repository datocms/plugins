/**
 * TranslationRow.tsx
 * ------------------
 * One field and locale of a whole-record translation in the sidebar panel:
 * the logo of the configured vendor (an icon avatar of the row's image
 * size), the field label, and under it the locale and the state (an inline
 * spinner before the state while the field is translated, then a dot before
 * the result). A click on the row scrolls the form to the field in that
 * locale.
 */
import EntityRow from 'datocms-react-ui/EntityRow';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import IconAvatar from 'datocms-react-ui/IconAvatar';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import { type ReactNode, useEffect, useState } from 'react';
import { PENDING_HINT_THRESHOLD_SECONDS } from '../../../utils/constants';
import { formatLocaleWithCode } from '../../../utils/localeUtils';
import type { VendorId } from '../../../utils/translation/types';
import { getVendorIcon } from './vendorIcon';

export type TranslationRowStatus = 'pending' | 'done' | 'error';

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

type Props = {
  row: TranslationRowState;
  /** The configured vendor: its logo is the image of the row. */
  vendor?: VendorId;
  onOpen: (row: TranslationRowState) => void;
};

/**
 * True once the row has been translating for PENDING_HINT_THRESHOLD_SECONDS,
 * so a large field reads as slow rather than stuck.
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

/** The mark before the state: a spinner while it runs, then a dot. */
function stateMark(status: TranslationRowStatus): ReactNode {
  if (status === 'pending') return <Spinner inline label={false} />;
  return <FeedbackDot tone={status === 'done' ? 'success' : 'danger'} />;
}

/** The state of the row in words. */
function stateWord(status: TranslationRowStatus, slow: boolean): string {
  if (status === 'done') return 'Translated';
  if (status === 'error') return 'Failed';
  return slow ? 'Still translating a large field…' : 'Translating…';
}

/**
 * A row of the running translation. It is a button: its name is the field
 * label, the locale and the state, as they show.
 */
export function TranslationRow({ row, vendor, onOpen }: Props) {
  const VendorIcon = getVendorIcon(vendor);
  const slow = useIsSlow(row.status);

  return (
    <RowList.Item onClick={() => onOpen(row)}>
      <EntityRow
        layout="row"
        image={<IconAvatar icon={VendorIcon} size={32} surface="muted" />}
        title={row.fieldLabel}
      >
        {formatLocaleWithCode(row.locale)} · {stateMark(row.status)}{' '}
        {stateWord(row.status, slow)}
      </EntityRow>
    </RowList.Item>
  );
}
