import type { SchemaTypes } from '@datocms/cma-client';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import type { Message } from 'datocms-react-ui/Message';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useMemo, useState } from 'react';
import { CircleExclamationIcon, ModelIcon, RefreshIcon } from '@/icons';
import {
  describeSchemaReadError,
  errorCode,
  isPermissionError,
} from '@/utils/apiError';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';

type MultiOption = {
  label: string;
  value: string;
  searchText?: string;
  isBlock?: boolean;
};

type OptionGroup = {
  label: string;
  options: MultiOption[];
};

type Props = {
  /** Every item type of the environment, once loaded */
  itemTypes?: SchemaTypes.ItemType[];
  /** The item types could not be loaded */
  error?: Error;
  /** Loads the item types again, after an error */
  onRetry?: () => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Opens the dependency graph of the picks */
  onContinue: () => void;
};

const largeSelectionThreshold = 200;
const visibleOptionLimit = 100;

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

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

/** The menu of the select: the models, then the blocks */
function groupByKind(options: MultiOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [
    { label: 'Models', options: options.filter((option) => !option.isBlock) },
    { label: 'Blocks', options: options.filter((option) => option.isBlock) },
  ];
  return groups.filter((group) => group.options.length > 0);
}

/** The search of a short list: name, API key and ID, ignoring accents */
function matchesSearch(option: { data: MultiOption }, inputValue: string) {
  const query = normalizeSearch(inputValue.trim());
  return normalizeSearch(option.data.searchText ?? option.data.label).includes(
    query,
  );
}

/** The models and blocks could not be loaded */
function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  // Another attempt can't give a permission
  const forbidden = isPermissionError(error);

  return (
    <BlankSlate
      placement="inline"
      small
      error
      icon={<CircleExclamationIcon />}
      title="The models and blocks could not be loaded"
      code={errorCode(error)}
      description={describeSchemaReadError(error)}
      actions={
        onRetry && !forbidden ? (
          <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
        ) : undefined
      }
    />
  );
}

/**
 * The first group of the start step of the export: the models and blocks the
 * dependency graph starts from. The first pick is the root of the export.
 */
export function ExportSelectionPanel({
  itemTypes,
  error,
  onRetry,
  selectedIds,
  onSelectedIdsChange,
  onContinue,
}: Props) {
  const [query, setQuery] = useState('');

  const options = useMemo<MultiOption[]>(
    () =>
      (itemTypes ?? [])
        .map((itemType) => {
          const { name, api_key: apiKey, modular_block } = itemType.attributes;
          return {
            value: itemType.id,
            label: name,
            searchText: `${name} ${apiKey} ${itemType.id}`,
            isBlock: modular_block,
          };
        })
        .sort((a, b) =>
          nameCollator.compare(
            getTextWithoutRepresentativeEmojiAndPadding(a.label),
            getTextWithoutRepresentativeEmojiAndPadding(b.label),
          ),
        ),
    [itemTypes],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Past 200 options the menu shows at most 100 matches. The chosen options
  // stay in the list (the menu hides them), thus their pills keep a label.
  const isLargeSelection = options.length > largeSelectionThreshold;
  const visibleOptions = useMemo(
    () =>
      isLargeSelection
        ? getVisibleExportOptions(options, selectedIdSet, query)
        : undefined,
    [isLargeSelection, options, selectedIdSet, query],
  );
  const menuOptions = useMemo(() => {
    if (!visibleOptions) {
      return groupByKind(options);
    }
    const chosen = options.filter((option) => selectedIdSet.has(option.value));
    return groupByKind([...chosen, ...visibleOptions.options]);
  }, [options, selectedIdSet, visibleOptions]);

  const hint: Message =
    visibleOptions && visibleOptions.totalMatches > visibleOptionLimit
      ? {
          id: 'importExportSchema.exportOptionsCapped',
          values: { total: visibleOptions.totalMatches },
        }
      : 'The next step shows what they use, so you can add it to the file too.';

  // The environment has nothing to pick: the group says so, with no select
  // and no Continue
  const isEmpty = !error && itemTypes?.length === 0;

  return (
    <Page.Group
      title="Models and blocks"
      footer={
        error || isEmpty ? undefined : (
          <Button
            label="Continue"
            tone="primary"
            onClick={onContinue}
            disabled={
              selectedIds.length === 0
                ? { reason: 'Choose at least one model or block.' }
                : undefined
            }
          />
        )
      }
    >
      {error ? (
        <LoadError error={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <BlankSlate
          placement="inline"
          small
          icon={<ModelIcon />}
          title="No models or blocks yet"
          description="Models and blocks show here once you create them in the schema or import a schema file."
        />
      ) : (
        <FieldWrapper label="What to export" hint={hint}>
          <SelectInput<MultiOption, OptionGroup>
            multiple
            clearable
            name="export-initial-models"
            placeholder="Choose models or blocks"
            options={menuOptions}
            value={selectedIds}
            onChange={(ids) => onSelectedIdsChange(ids ?? [])}
            loading={!itemTypes}
            disabled={!itemTypes}
            {...(isLargeSelection
              ? { search: { onQueryChange: setQuery } }
              : { filterOption: matchesSearch })}
          />
        </FieldWrapper>
      )}
    </Page.Group>
  );
}
