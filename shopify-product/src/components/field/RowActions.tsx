import { faEye, faTrashCan } from '@fortawesome/free-regular-svg-icons';
import {
  type IconDefinition,
  faArrowRightArrowLeft,
  faArrowUpRightFromSquare,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../ui/Icon';
import Tip from '../shared/Tip';
import styles from './EntryRow.module.css';
import { ROW_FOCUS_ATTRIBUTE } from './useFieldFeedback';

type Props = {
  /** Names the row in the group's accessible label. */
  title: string;
  adminUrl: string | null;
  /** For entries saved without an ID: search the admin for the handle. */
  adminSearchUrl: string | null;
  storefrontUrl: string | null;
  disabled: boolean;
  onReplace: () => void;
  onRemove: () => void;
  /** The drag overlay's copy: same width, but invisible and inert. */
  ghost?: boolean;
  /** The row's warning strip already offers Replace and Remove. */
  linksOnly?: boolean;
};

type Action = {
  key: string;
  label: string;
  icon: IconDefinition;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function adminAction(
  adminUrl: string | null,
  adminSearchUrl: string | null,
): Action | null {
  if (adminUrl) {
    return {
      key: 'admin',
      label: 'Open in Shopify admin',
      icon: faArrowUpRightFromSquare,
      onClick: () => openExternal(adminUrl),
    };
  }
  if (adminSearchUrl) {
    return {
      key: 'admin',
      label: 'Search in Shopify admin',
      icon: faMagnifyingGlass,
      onClick: () => openExternal(adminSearchUrl),
    };
  }
  return null;
}

function rowActions(props: Props): Action[] {
  const actions: Array<Action | null> = [
    adminAction(props.adminUrl, props.adminSearchUrl),
    props.storefrontUrl
      ? {
          key: 'store',
          label: 'View on store',
          icon: faEye,
          onClick: () => openExternal(props.storefrontUrl ?? ''),
        }
      : null,
    {
      key: 'replace',
      label: 'Replace',
      icon: faArrowRightArrowLeft,
      onClick: props.onReplace,
      disabled: props.disabled,
    },
    {
      key: 'remove',
      label: 'Remove',
      icon: faTrashCan,
      onClick: props.onRemove,
      disabled: props.disabled,
      danger: true,
    },
  ];
  return actions.filter(
    (action): action is Action =>
      action !== null &&
      !(
        props.linksOnly &&
        (action.key === 'replace' || action.key === 'remove')
      ),
  );
}

/**
 * The row's actions as icon buttons that fade in on hover. A ⋮ menu would
 * have to grow the field's iframe to show itself (nothing draws outside a
 * plugin frame), leaving a big blank gap under the field while it's open.
 */
export default function RowActions(props: Props) {
  const actions = rowActions(props);
  return (
    <div
      className={props.ghost ? styles.actionsGhost : styles.actions}
      role={props.ghost ? undefined : 'group'}
      aria-label={props.ghost ? undefined : `Actions for ${props.title}`}
      aria-hidden={props.ghost || undefined}
      inert={props.ghost || undefined}
    >
      {actions.map((action, index) => {
        const button = (
          <button
            key={action.key}
            type="button"
            className={[
              'dl-icon-button',
              styles.action,
              action.danger ? styles.actionDanger : '',
            ].join(' ')}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
            {...(index === 0 ? { [ROW_FOCUS_ATTRIBUTE]: '' } : {})}
          >
            <Icon icon={action.icon} />
          </button>
        );
        // A disabled button gets no pointer events, so no tip while busy.
        return action.disabled ? (
          <span key={action.key}>{button}</span>
        ) : (
          <Tip key={action.key} tip={action.label}>
            {button}
          </Tip>
        );
      })}
    </div>
  );
}
