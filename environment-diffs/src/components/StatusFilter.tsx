import type { FilterValue } from '../types';

const FILTER_LABELS: Record<FilterValue, string> = {
  all: 'All',
  changed: 'Changed',
  leftOnly: 'Left only',
  rightOnly: 'Right only',
  unchanged: 'Unchanged',
};

type Props = {
  value: FilterValue;
  onChange: (value: FilterValue) => void;
};

export function StatusFilter({ value, onChange }: Props) {
  return (
    <div className="status-filter" role="tablist" aria-label="Diff filter">
      {(Object.keys(FILTER_LABELS) as FilterValue[]).map((filter) => (
        <button
          key={filter}
          type="button"
          className={`status-filter__button${value === filter ? ' is-active' : ''}`}
          onClick={() => onChange(filter)}
        >
          {FILTER_LABELS[filter]}
        </button>
      ))}
    </div>
  );
}
