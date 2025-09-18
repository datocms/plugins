import type { SchemaTypes } from '@datocms/cma-client';
import { Button, SelectField } from 'datocms-react-ui';
import { useMemo } from 'react';

type MultiOption = { label: string; value: string };
type SelectGroup<OptionType> = {
  label?: string;
  options: readonly OptionType[];
};

type Props = {
  selectId: string;
  itemTypes?: SchemaTypes.ItemType[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onStart: () => void;
  startDisabled: boolean;
  onExportAll: () => void | Promise<void>;
  exportAllDisabled: boolean;
  title?: string;
  description?: string;
  selectLabel?: string;
  startLabel?: string;
  exportAllLabel?: string;
};

/**
 * Blank-slate panel that lets editors pick the starting set of models/blocks and kick
 * off either a targeted or full-schema export.
 */
export function ExportStartPanel({
  selectId,
  itemTypes,
  selectedIds,
  onSelectedIdsChange,
  onStart,
  startDisabled,
  onExportAll,
  exportAllDisabled,
  title = 'Start a new export',
  description = 'Select one or more models/blocks to start selecting what to export.',
  selectLabel = 'Starting models/blocks',
  startLabel = 'Export Selected',
  exportAllLabel = 'Export entire schema',
}: Props) {
  const options = useMemo<MultiOption[]>(
    () =>
      (itemTypes ?? []).map((it) => ({
        value: it.id,
        label: `${it.attributes.name}${
          it.attributes.modular_block ? ' (Block)' : ''
        }`,
      })),
    [itemTypes],
  );

  // React-Select expects objects; keep them memoized so the control stays controlled.
  const value = useMemo(
    () => options.filter((opt) => selectedIds.includes(opt.value)),
    [options, selectedIds],
  );

  return (
    <div className="blank-slate__body">
      <div className="blank-slate__body__title">{title}</div>
      <div className="blank-slate__body__content">
        <p>{description}</p>
        <div className="export-selector">
          <div className="export-selector__field">
            <SelectField<MultiOption, true, SelectGroup<MultiOption>>
              id={selectId}
              name="export-initial-model"
              label={selectLabel}
              selectInputProps={{
                isMulti: true,
                isClearable: true,
                isDisabled: !itemTypes,
                options,
                placeholder: 'Choose models/blocks…',
              }}
              value={value}
              onChange={(multi) =>
                onSelectedIdsChange(
                  Array.isArray(multi) ? multi.map((o) => o.value) : [],
                )
              }
            />
          </div>
          <div className="export-selector__cta">
            <Button
              buttonType="primary"
              disabled={startDisabled}
              onClick={onStart}
            >
              {startLabel}
            </Button>
          </div>
          <div className="export-selector__cta">
            <Button
              buttonSize="s"
              buttonType="muted"
              fullWidth
              disabled={exportAllDisabled}
              onClick={() => {
                void onExportAll();
              }}
            >
              {exportAllLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
