import { useMemo, useState } from 'react';
import type { ChipOption } from './chipOption';

export const CHIP_OPTION_LIMIT = 100;

export function boundedSelectHint(hint: string | undefined, fallback: string) {
  return hint ? `${fallback}. ${hint}` : fallback;
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
    if (
      search &&
      !normalize(
        `${option.label} ${option.code ?? ''} ${option.value}`,
      ).includes(search)
    )
      continue;
    visible.push(option);
    if (visible.length === CHIP_OPTION_LIMIT) break;
  }
  return visible;
}

/** Bound menus and selected-value DOM only for unusually large catalogs. */
export function useBoundedChipSelect<T extends ChipOption>(
  options: readonly T[],
  selected: readonly T[],
  noun: string,
  multi = true,
) {
  const [query, setQuery] = useState('');
  const large = options.length > CHIP_OPTION_LIMIT;
  const compact = multi && selected.length > CHIP_OPTION_LIMIT;
  const selectedIds = useMemo(
    () => new Set(selected.map((o) => o.value)),
    [selected],
  );
  const visibleOptions = useMemo(
    () =>
      visibleChipOptions(
        options,
        query,
        multi && !compact ? selectedIds : undefined,
      ),
    [options, query, multi, compact, selectedIds],
  );
  return {
    placeholder: (fallback: string) =>
      compact
        ? `${selected.length.toLocaleString()} ${noun} selected`
        : fallback,
    hint: large
      ? `Showing up to ${CHIP_OPTION_LIMIT} results. Type to search all ${noun}.${compact ? ` Search a selected entry to remove it.` : ''}`
      : undefined,
    selectProps: {
      options: visibleOptions,
      ...(large
        ? {
            onInputChange: setQuery,
            filterOption: null,
            isOptionSelected: (option: T) => selectedIds.has(option.value),
          }
        : {}),
      ...(compact
        ? {
            controlShouldRenderValue: false,
            hideSelectedOptions: false,
          }
        : {}),
    },
  };
}
