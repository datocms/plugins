import type { DragEvent } from 'react';
import type { ColumnId, ColumnSetting } from '../types';
import styles from './AllRecordsTable.module.css';
import { ALL_COLUMN_IDS, reorderColumn, toggleColumn } from './columnSettings';
import type { ColumnSettingsHandler, TableColumn } from './types';

export type ColumnSettingsMenuProps = {
  availableColumns: readonly TableColumn[];
  columns: readonly ColumnSetting[];
  onChange: ColumnSettingsHandler;
};

export function ColumnSettingsMenu({
  availableColumns,
  columns,
  onChange,
}: ColumnSettingsMenuProps) {
  const activeIds = new Set(columns.map((column) => column.id));
  const labels = new Map(
    availableColumns.map((column) => [column.id, column.label]),
  );

  function handleDragStart(event: DragEvent, sourceId: ColumnId) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sourceId);
  }

  function handleDrop(event: DragEvent, targetId: ColumnId) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') as ColumnId;
    onChange(reorderColumn(columns, sourceId, targetId));
  }

  return (
    <details className={styles.settings}>
      <summary aria-label="Configure table columns" title="Configure columns">
        <svg aria-hidden="true" viewBox="0 0 512 512">
          <path d="M487.4 315.7 460.7 300c2.2-14.7 2.2-29.3 0-44l26.7-15.7a24 24 0 0 0 9.3-31.8l-31.2-54a24 24 0 0 0-30.9-10.4l-27.2 14.8a180.2 180.2 0 0 0-38.1-22l-.5-31A24 24 0 0 0 344.8 82h-62.4a24 24 0 0 0-24 23.9l-.5 31a180.2 180.2 0 0 0-38.1 22l-27.2-14.8a24 24 0 0 0-30.9 10.4l-31.2 54a24 24 0 0 0 9.3 31.8l26.7 15.7a149.8 149.8 0 0 0 0 44l-26.7 15.7a24 24 0 0 0-9.3 31.8l31.2 54a24 24 0 0 0 30.9 10.4l27.2-14.8a180.2 180.2 0 0 0 38.1 22l.5 31a24 24 0 0 0 24 23.9h62.4a24 24 0 0 0 24-23.9l.5-31a180.2 180.2 0 0 0 38.1-22l27.2 14.8a24 24 0 0 0 30.9-10.4l31.2-54a24 24 0 0 0-9.3-31.8ZM313.6 342a64 64 0 1 1 0-128 64 64 0 1 1 0 128Z" />
        </svg>
      </summary>
      <div className={styles.settingsMenu} role="menu">
        <div className={styles.settingsHeading}>Displayed columns</div>
        {columns.map((column) => (
          <div
            key={column.id}
            draggable
            onDragStart={(event) => handleDragStart(event, column.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, column.id)}
          >
            <button
              type="button"
              className={styles.settingsOption}
              role="menuitemcheckbox"
              aria-checked="true"
              disabled={columns.length === 1}
              onClick={() => onChange(toggleColumn(columns, column.id))}
            >
              <span
                className={`${styles.settingsCheck} ${styles.settingsCheckActive}`}
                aria-hidden="true"
              >
                ✓
              </span>
              {labels.get(column.id) ?? column.id}
              <span className={styles.settingsDragHandle} aria-hidden="true">
                ⠿
              </span>
            </button>
          </div>
        ))}

        {ALL_COLUMN_IDS.some((id) => !activeIds.has(id)) && (
          <div className={styles.settingsHeading}>Available columns</div>
        )}
        {ALL_COLUMN_IDS.filter((id) => !activeIds.has(id)).map((id) => (
          <button
            type="button"
            key={id}
            className={styles.settingsOption}
            role="menuitemcheckbox"
            aria-checked="false"
            onClick={() => onChange(toggleColumn(columns, id))}
          >
            <span className={styles.settingsCheck} aria-hidden="true" />
            {labels.get(id) ?? id}
          </button>
        ))}
      </div>
    </details>
  );
}
