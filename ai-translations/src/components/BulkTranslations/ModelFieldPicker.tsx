/**
 * ModelFieldPicker.tsx
 * --------------------
 * One disclosure-style panel per model showing rows of checkboxes for that
 * model's translatable fields. Each row pairs the field's friendly label
 * with its api_key as muted secondary text — matching how DatoCMS itself
 * surfaces api_keys in its settings screens.
 *
 * Pure presentation: data flows in via props, behavior bubbles out via
 * callbacks. Shared between the standalone bulk page and the records-action
 * picker modal.
 */
import { Spinner } from 'datocms-react-ui';
import { useMemo } from 'react';
import type { TranslatableField } from '../../utils/translation/BulkTranslationHelpers';
import s from './ModelFieldPicker.module.css';

/**
 * Light projection of the model representation used by the surrounding form.
 * `label` is the human name; `code` is the api_key (for the row title);
 * `value` is the model id (used as the picker key on the parent).
 */
export interface ModelFieldPickerModel {
  label: string;
  value: string;
  code: string;
}

export interface ModelFieldPickerProps {
  model: ModelFieldPickerModel;
  fields: TranslatableField[] | undefined;
  isLoading: boolean;
  selectedApiKeys: string[];
  onToggle: (apiKey: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  /**
   * Hide the model label/api_key header — for surfaces where only one
   * model can ever be in play (sidebar on a single record, records-action
   * picker modal whose dropdown is registered per-model). The Select all /
   * Clear shortcuts move into a compact actions row above the field list,
   * and the surrounding panel chrome is dropped so the picker sits flush
   * with the parent form. Defaults to false → full panel + header.
   */
  hideModelHeader?: boolean;
}

export function ModelFieldPicker({
  model,
  fields,
  isLoading,
  selectedApiKeys,
  onToggle,
  onSelectAll,
  onClearAll,
  hideModelHeader = false,
}: ModelFieldPickerProps) {
  const selectedSet = useMemo(
    () => new Set(selectedApiKeys),
    [selectedApiKeys],
  );

  const actionsRow =
    fields && fields.length > 0 ? (
      <span className={s.modelPanelActions}>
        <button
          type="button"
          className={s.linkButton}
          onClick={onSelectAll}
        >
          Select all
        </button>
        <span className={s.linkSeparator} aria-hidden>
          ·
        </span>
        <button
          type="button"
          className={s.linkButton}
          onClick={onClearAll}
        >
          Clear
        </button>
      </span>
    ) : null;

  const body = isLoading ? (
    <div className={s.modelPanelLoading}>
      <Spinner size={16} />
      <span>Loading fields…</span>
    </div>
  ) : !fields || fields.length === 0 ? (
    <div className={s.modelPanelEmpty}>
      No translatable fields on this model. Adjust the plugin settings to
      allow more field types, or pick a different model.
    </div>
  ) : (
    <ul className={s.fieldList}>
      {fields.map((field) => {
        const checked = selectedSet.has(field.apiKey);
        return (
          <li key={field.apiKey} className={s.fieldRow}>
            <label className={s.fieldLabel}>
              <input
                type="checkbox"
                className={s.fieldCheckbox}
                checked={checked}
                onChange={() => onToggle(field.apiKey)}
              />
              <span className={s.fieldName}>{field.label}</span>
              <span className={s.fieldApiKey}>{field.apiKey}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );

  if (hideModelHeader) {
    return (
      <div className={s.bareFieldPicker}>
        {actionsRow && <div className={s.bareActions}>{actionsRow}</div>}
        {body}
      </div>
    );
  }

  return (
    <div className={s.modelPanel}>
      <div className={s.modelPanelHeader}>
        <span className={s.modelPanelTitle}>
          {model.label}
          <code className={s.modelPanelCode}>{model.code}</code>
        </span>
        {actionsRow}
      </div>
      {body}
    </div>
  );
}
