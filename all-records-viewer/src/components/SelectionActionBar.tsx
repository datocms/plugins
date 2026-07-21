import styles from './SelectionActionBar.module.css';
import type { SelectionAction, SelectionActionId } from './types';

export type SelectionActionBarProps = {
  selectedCount: number;
  showingSelected: boolean;
  onToggleShowingSelected: () => void;
  onInvertSelection: () => void;
  onClearSelection: () => void;
  actions: Partial<Record<SelectionActionId, SelectionAction>>;
  disabled?: boolean;
  busyAction?: SelectionActionId | null;
  canManipulateSelection?: boolean;
};

function ActionButton({
  action,
  id,
  disabled,
  busyAction,
}: {
  action: SelectionAction;
  id: SelectionActionId;
  disabled: boolean;
  busyAction?: SelectionActionId | null;
}) {
  const defaultLabels: Record<SelectionActionId, string> = {
    delete: 'Delete',
    publish: 'Publish',
    unpublish: 'Unpublish',
    move: 'Move to stage',
  };

  return (
    <button
      type="button"
      className={`${styles.button} ${styles.primaryButton}`}
      disabled={disabled || action.disabled}
      title={action.disabledReason}
      aria-busy={busyAction === id}
      onClick={action.onClick}
    >
      {busyAction === id ? 'Working…' : (action.label ?? defaultLabels[id])}
    </button>
  );
}

export function SelectionActionBar({
  selectedCount,
  showingSelected,
  onToggleShowingSelected,
  onInvertSelection,
  onClearSelection,
  actions,
  disabled = false,
  busyAction = null,
  canManipulateSelection = true,
}: SelectionActionBarProps) {
  if (selectedCount <= 0) return null;
  const actionDisabled = disabled || busyAction !== null;

  return (
    <div className={styles.bar} role="region" aria-label="Selection actions">
      <div className={styles.content}>
        <div className={styles.status}>
          {selectedCount} {selectedCount === 1 ? 'record' : 'records'} selected
        </div>
        <div className={styles.actions}>
          {canManipulateSelection && (
            <div className={`${styles.group} ${styles.secondary}`}>
              <button
                type="button"
                className={styles.button}
                disabled={actionDisabled}
                onClick={onToggleShowingSelected}
              >
                {showingSelected ? 'Hide selection' : 'Show selection'}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={actionDisabled}
                onClick={onInvertSelection}
              >
                Invert selection
              </button>
            </div>
          )}

          {actions.delete && (
            <ActionButton
              id="delete"
              action={actions.delete}
              disabled={actionDisabled}
              busyAction={busyAction}
            />
          )}

          {(actions.publish || actions.unpublish) && (
            <div className={styles.group}>
              {actions.publish && (
                <ActionButton
                  id="publish"
                  action={actions.publish}
                  disabled={actionDisabled}
                  busyAction={busyAction}
                />
              )}
              {actions.unpublish && (
                <ActionButton
                  id="unpublish"
                  action={actions.unpublish}
                  disabled={actionDisabled}
                  busyAction={busyAction}
                />
              )}
            </div>
          )}

          {actions.move && (
            <ActionButton
              id="move"
              action={actions.move}
              disabled={actionDisabled}
              busyAction={busyAction}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        className={styles.close}
        disabled={actionDisabled}
        aria-label="Deselect all records"
        title="Deselect all records"
        onClick={onClearSelection}
      >
        <svg aria-hidden="true" viewBox="0 0 384 512">
          <path d="M342.6 150.6a32 32 0 0 0-45.3-45.3L192 210.7 86.6 105.4a32 32 0 0 0-45.3 45.3L146.7 256 41.4 361.4a32 32 0 0 0 45.3 45.3L192 301.3l105.4 105.3a32 32 0 0 0 45.3-45.3L237.3 256l105.3-105.4Z" />
        </svg>
      </button>
    </div>
  );
}
