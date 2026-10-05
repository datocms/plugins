import {
  faPlus,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { addLabel, type LimitsSummary } from '../../lib/fieldValue';
import type { ShopifyKind } from '../../types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import Tip from '../shared/Tip';
import styles from './FieldParts.module.css';
import { FIELD_ACTION_ATTRIBUTE } from './useFieldFeedback';

type Props = {
  kind: ShopifyKind;
  limits: LimitsSummary;
  readOnly: boolean;
  /** Another action is running (not this one: it keeps focus while it runs). */
  busy: boolean;
  onAdd: () => void;
};

/** Under a multiple field's rows: "Add products", the "3 of 10" counter. */
export function ListFooter({ kind, limits, readOnly, busy, onAdd }: Props) {
  if (readOnly && !limits.counter) return null;
  return (
    <div className={styles.footer}>
      {!readOnly && (
        <span
          className={styles.footerAction}
          {...{ [FIELD_ACTION_ATTRIBUTE]: 'add' }}
        >
          <Tip
            tip={limits.atMaxReason}
            anchor={limits.atMax ? 'focusable' : true}
            anchorClassName={styles.tooltipTarget}
          >
            <Button
              buttonSize="s"
              leftIcon={<Icon icon={faPlus} />}
              disabled={busy || limits.atMax}
              onClick={onAdd}
            >
              {addLabel(kind)}
            </Button>
          </Tip>
        </span>
      )}
      {limits.counter && (
        <span
          className={[
            styles.counter,
            !readOnly && limits.aboveMax ? styles.counterWarning : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {limits.counter}
        </span>
      )}
    </div>
  );
}

type LimitHintProps = {
  message: string | null;
  /** A warning once some items are selected; a plain hint while empty. */
  warning: boolean;
};

/** "Add at least 2 products", "Remove 2 products, as this field holds up to 3". */
export function LimitHint({ message, warning }: LimitHintProps) {
  if (!message) return null;
  return (
    <p
      className={[styles.limitHint, warning ? styles.limitWarning : '']
        .filter(Boolean)
        .join(' ')}
    >
      {warning && <Icon icon={faTriangleExclamation} />}
      {message}
    </p>
  );
}
