import FilterBuilder, {
  type FilterCondition as BuilderCondition,
} from 'datocms-react-ui/FilterBuilder';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useMemo, useState } from 'react';
import { builderConditionsOf, filterConditionsOf } from '../filters/builder';
import { serializeFilterConditions } from '../filters/filters';
import type { FilterCondition, FilterField } from '../filters/types';
import { builderFieldsOf, type Creators } from './filterEditors';

type Draft = {
  fields: readonly FilterField[];
  /** The conditions of the URL that the draft comes from */
  source: readonly FilterCondition[];
  /** The conditions for the URL, one for each condition of the builder */
  filters: readonly FilterCondition[];
  builder: BuilderCondition[];
};

function draftOf(
  filters: readonly FilterCondition[],
  fields: readonly FilterField[],
): Draft {
  return {
    fields,
    source: filters,
    filters,
    builder: builderConditionsOf(filters, fields),
  };
}

/**
 * The conditions of the builder, kept apart from the URL: a value that is
 * not complete yet (a point with no radius) has no value in the URL, and
 * stays in its tile. The builder follows the URL when the URL changes to
 * other conditions (a link, the history), not when it gets the change that
 * the builder sent.
 */
function useBuilderConditions(
  filters: readonly FilterCondition[],
  fields: readonly FilterField[],
  onFiltersChange: (filters: FilterCondition[]) => void,
) {
  const [draft, setDraft] = useState(() => draftOf(filters, fields));
  let current = draft;
  if (draft.fields !== fields) {
    current = draftOf(filters, fields);
  } else if (draft.source !== filters) {
    current =
      serializeFilterConditions(filters) ===
      serializeFilterConditions(draft.filters)
        ? { ...draft, source: filters }
        : draftOf(filters, fields);
  }
  if (current !== draft) setDraft(current);

  const onChange = (builder: BuilderCondition[]) => {
    const next = filterConditionsOf(builder, current, fields);
    setDraft({ ...current, filters: next, builder });
    if (
      serializeFilterConditions(next) !==
      serializeFilterConditions(current.filters)
    ) {
      onFiltersChange(next);
    }
  };

  return { value: current.builder, onChange };
}

/**
 * The filter row of the list, as in the record list of the dashboard: the
 * text filter, then the filter builder, with one tile for each filter.
 */
export function FilterBar({
  search,
  searchDisabled,
  autoFocus,
  onSearchChange,
  onClose,
  filters,
  fields,
  locales,
  creators,
  filtersDisabled,
  onFiltersChange,
}: {
  search: string;
  searchDisabled: boolean;
  autoFocus: boolean;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  filters: readonly FilterCondition[];
  fields: readonly FilterField[];
  locales: readonly string[];
  creators: Creators;
  filtersDisabled: boolean;
  onFiltersChange: (filters: FilterCondition[]) => void;
}) {
  const builderFields = useMemo(
    () => builderFieldsOf(fields, locales, creators),
    [creators, fields, locales],
  );
  const conditions = useBuilderConditions(filters, fields, onFiltersChange);

  return (
    <Toolbar.Search>
      <Toolbar.FilterInput
        value={search}
        onChange={onSearchChange}
        autoFocus={autoFocus}
        onClose={onClose}
        disabled={searchDisabled}
      />
      <Toolbar.Divider />
      <FilterBuilder
        fields={builderFields}
        value={conditions.value}
        onChange={conditions.onChange}
        disabled={filtersDisabled}
      />
    </Toolbar.Search>
  );
}
