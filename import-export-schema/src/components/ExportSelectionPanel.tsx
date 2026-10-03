import type { SchemaTypes } from '@datocms/cma-client';
import { Button, SelectField } from 'datocms-react-ui';
import { useMemo, useState } from 'react';

type MultiOption = { label: string; value: string; searchText?: string };
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

const largeSelectionThreshold = 200;
const visibleOptionLimit = 100;

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Keep large menus bounded while searching the complete schema. */
export function getVisibleExportOptions(
  options: MultiOption[],
  selectedIds: ReadonlySet<string>,
  inputValue: string,
) {
  const query = normalizeSearch(inputValue.trim());
  const visible: MultiOption[] = [];
  let totalMatches = 0;
  for (const option of options) {
    if (selectedIds.has(option.value)) continue;
    if (!normalizeSearch(option.searchText ?? option.label).includes(query)) {
      continue;
    }
    totalMatches += 1;
    if (visible.length < visibleOptionLimit) visible.push(option);
  }
  return { options: visible, totalMatches };
}

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
  description = 'Choose the models and blocks you want to inspect. You can refine the selection on the next screen.',
  selectLabel = 'Starting models/blocks',
  startLabel = 'Export selection',
  backLabel = 'Back',
}: Props) {
  const [inputValue, setInputValue] = useState('');
  const options = useMemo<MultiOption[]>(
    () =>
      (itemTypes ?? []).map((itemType) => {
        const label = `${itemType.attributes.name}${
          itemType.attributes.modular_block ? ' (Block)' : ''
        }`;
        return {
          value: itemType.id,
          label,
          searchText: `${label} ${itemType.attributes.api_key} ${itemType.id}`,
        };
      }),
    [itemTypes],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // React-Select expects objects; keep them memoized so the control stays controlled.
  const value = useMemo(
    () => options.filter((option) => selectedIdSet.has(option.value)),
    [options, selectedIdSet],
  );
  const isLargeSelection = options.length > largeSelectionThreshold;
  const visibleOptions = useMemo(
    () => getVisibleExportOptions(options, selectedIdSet, inputValue),
    [options, selectedIdSet, inputValue],
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
              hint={
                isLargeSelection &&
                visibleOptions.totalMatches > visibleOptionLimit
                  ? `Showing the first ${visibleOptionLimit} of ${visibleOptions.totalMatches} matches. Search by name or API identifier to narrow the list.`
                  : undefined
              }
              selectInputProps={{
                isMulti: true,
                isClearable: true,
                isDisabled: !itemTypes,
                options: isLargeSelection ? visibleOptions.options : options,
                isOptionSelected: (option) => selectedIdSet.has(option.value),
                ...(isLargeSelection
                  ? {
                      inputValue,
                      onInputChange: setInputValue,
                      filterOption: null,
                    }
                  : {}),
                placeholder: 'Choose models/blocks…',
              }}
              value={value}
              onChange={(multi) =>
                onSelectedIdsChange(
                  Array.isArray(multi)
                    ? multi.map((option) => option.value)
                    : [],
                )
              }
            />
          </div>
          <div className="export-selector__actions">
            <Button buttonType="muted" buttonSize="s" onClick={onBack}>
              {backLabel}
            </Button>
            <Button
              buttonType="primary"
              disabled={startDisabled}
              onClick={onStart}
            >
              {startLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
