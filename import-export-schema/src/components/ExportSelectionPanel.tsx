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
  onBack: () => void;
  startDisabled: boolean;
  title?: string;
  description?: string;
  selectLabel?: string;
  startLabel?: string;
  backLabel?: string;
};

/**
 * Secondary step of the export flow that lets editors pick targeted models/blocks
 * before jumping into the dependency graph.
 */
export function ExportSelectionPanel({
  selectId,
  itemTypes,
  selectedIds,
  onSelectedIdsChange,
  onStart,
  onBack,
  startDisabled,
  title = 'Select models to export',
  description =
    'Choose the models and blocks you want to inspect. You can refine the selection on the next screen.',
  selectLabel = 'Starting models/blocks',
  startLabel = 'Export selection',
  backLabel = 'Back',
}: Props) {
  const options = useMemo<MultiOption[]>(
    () =>
      (itemTypes ?? []).map((itemType) => ({
        value: itemType.id,
        label: `${itemType.attributes.name}${
          itemType.attributes.modular_block ? ' (Block)' : ''
        }`,
      })),
    [itemTypes],
  );

  // React-Select expects objects; keep them memoized so the control stays controlled.
  const value = useMemo(
    () => options.filter((option) => selectedIds.includes(option.value)),
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
                  Array.isArray(multi) ? multi.map((option) => option.value) : [],
                )
              }
            />
          </div>
          <div className="export-selector__actions">
            <Button buttonType="muted" buttonSize="s" onClick={onBack}>
              {backLabel}
            </Button>
            <Button buttonType="primary" disabled={startDisabled} onClick={onStart}>
              {startLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
