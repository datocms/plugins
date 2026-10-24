/**
 * useBoundedChipSelect.ts
 * -----------------------
 * Keeps the bulk translation selects fast with unusually large catalogs
 * (thousands of models or fields). The menu shows at most
 * `CHIP_OPTION_LIMIT` options, the search covers the whole catalog, and above
 * `CHIP_OPTION_LIMIT` selected values the control shows a count instead of
 * one pill per value (compact mode: the menu then lists the selected options
 * in a group of their own, to remove them). Small catalogs keep the plain
 * select.
 *
 * The hook returns props for the v3 `SelectInput`, whose values are strings:
 * spread `selectProps` on the select, and use `placeholder` and `hint` for
 * the texts.
 */
import type { SelectSearch } from 'datocms-react-ui/SelectInput';
import { useCallback, useMemo, useState } from 'react';
import { formatCount } from './bulkCopy';
import type { ChipOption } from './chipOption';

export const CHIP_OPTION_LIMIT = 100;

/**
 * The hint of a bounded select: the field's own hint, then the bounded
 * catalog note when there is one.
 */
export function boundedSelectHint(hint: string | undefined, fallback: string) {
  return hint ? `${fallback}. ${hint}` : fallback;
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Whether the label, the API key or the value contains the normalized query. */
function matchesQuery(option: ChipOption, normalizedQuery: string) {
  return normalize(
    `${option.label} ${option.code ?? ''} ${option.value}`,
  ).includes(normalizedQuery);
}

/** Search covers the entire catalog, even when the menu shows only 100 rows. */
export function visibleChipOptions<T extends ChipOption>(
  options: readonly T[],
  query: string,
  hiddenSelectedIds?: ReadonlySet<string>,
): readonly T[] {
  if (options.length <= CHIP_OPTION_LIMIT) return options;
  const search = normalize(query.trim());
  const visible: T[] = [];
  for (const option of options) {
    if (hiddenSelectedIds?.has(option.value)) continue;
    if (search && !matchesQuery(option, search)) continue;
    visible.push(option);
    if (visible.length === CHIP_OPTION_LIMIT) break;
  }
  return visible;
}

/**
 * The select's own filter for small catalogs: the same rule as the search of
 * large ones, so typing an API key finds its model or field.
 */
function filterChipOption<T extends ChipOption>(
  candidate: { data: T },
  input: string,
) {
  const search = normalize(input.trim());
  return !search || matchesQuery(candidate.data, search);
}

/** A group of options in the menu of a compact select. */
export type ChipOptionGroup<T extends ChipOption> = {
  label: string;
  options: readonly T[];
};

/**
 * In compact mode the selected options stay in the menu, so they can be
 * found and removed. A multi-select menu does not mark them, so they go in
 * their own group, before the others.
 */
function groupBySelection<T extends ChipOption>(
  options: readonly T[],
  selectedIds: ReadonlySet<string>,
  noun: string,
): ChipOptionGroup<T>[] {
  const selected = options.filter((option) => selectedIds.has(option.value));
  const others = options.filter((option) => !selectedIds.has(option.value));
  return [
    { label: `Selected ${noun}`, options: selected },
    { label: `Other ${noun}`, options: others },
  ].filter((group) => group.options.length > 0);
}

/** The react-select and SelectInput props that bound the select. */
export type BoundedSelectProps<T extends ChipOption> = {
  /**
   * The options that the menu shows: at most `CHIP_OPTION_LIMIT`, in two
   * groups (selected, others) in compact mode.
   */
  options: readonly T[] | readonly ChipOptionGroup<T>[];
  /** Finds a selected value outside the visible options in the catalog. */
  acceptValueNotIncludedInOptions: (value: string) => T | undefined;
  /** Small catalogs: the select filters its options itself. */
  filterOption?: (candidate: { data: T }, input: string) => boolean;
  /** Large catalogs: the hook filters the whole catalog for the query. */
  search?: SelectSearch;
  /** Compact mode: the control shows the count, not one pill per value. */
  controlShouldRenderValue?: false;
  /** Compact mode: selected options stay in the menu, to be removed there. */
  hideSelectedOptions?: false;
};

/**
 * Bounds the menu and the selected-value DOM only for unusually large
 * catalogs.
 *
 * @param options - The whole catalog.
 * @param selectedValues - The values the select holds.
 * @param noun - What the options are, plural ("models"), for the texts.
 * @param settings - `multi`: whether the select holds many values (default
 *   true). `locale`: the user's language (`ctx.ui.locale`), for the
 *   separators of the selected count.
 * @returns The props to spread on `SelectInput`, the placeholder for a
 *   fallback text, and the bounded catalog hint (or `undefined`).
 */
export function useBoundedChipSelect<T extends ChipOption>(
  options: readonly T[],
  selectedValues: readonly string[],
  noun: string,
  { multi = true, locale }: { multi?: boolean; locale?: string } = {},
) {
  const [query, setQuery] = useState('');
  const large = options.length > CHIP_OPTION_LIMIT;
  const compact = multi && selectedValues.length > CHIP_OPTION_LIMIT;
  const selectedIds = useMemo(() => new Set(selectedValues), [selectedValues]);
  const visibleOptions = useMemo(
    () =>
      visibleChipOptions(
        options,
        query,
        multi && !compact ? selectedIds : undefined,
      ),
    [options, query, multi, compact, selectedIds],
  );
  const optionsByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const acceptValueNotIncludedInOptions = useCallback(
    (value: string) => optionsByValue.get(value),
    [optionsByValue],
  );
  const search = useMemo<SelectSearch>(() => ({ onQueryChange: setQuery }), []);

  const menuOptions = useMemo(
    () =>
      compact
        ? groupBySelection(visibleOptions, selectedIds, noun)
        : visibleOptions,
    [compact, visibleOptions, selectedIds, noun],
  );

  const selectProps: BoundedSelectProps<T> = {
    options: menuOptions,
    acceptValueNotIncludedInOptions,
    ...(large ? { search } : { filterOption: filterChipOption }),
    ...(compact
      ? { controlShouldRenderValue: false, hideSelectedOptions: false }
      : {}),
  };

  return {
    placeholder: (fallback: string) =>
      compact
        ? `${formatCount(selectedValues.length, locale)} ${noun} selected`
        : fallback,
    hint: large
      ? `Showing up to ${CHIP_OPTION_LIMIT} results. Type to search all ${noun}.${compact ? ' Search a selected entry to remove it.' : ''}`
      : undefined,
    selectProps,
  };
}
