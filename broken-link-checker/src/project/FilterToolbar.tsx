import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { TextInput, Toolbar, ToolbarStack } from 'datocms-react-ui';
import { localeName } from '../report/format';
import {
  DEFAULT_FILTERS,
  type Filters,
  isDefaultFilters,
  type ReportDimensions,
  STATUS_ORDER,
  type StatusCounts,
  type StatusView,
} from '../report/view';
import { Icon } from '../ui/Icon';
import { STATUS_META } from '../ui/LogStatus';
import { WithTooltip } from '../ui/WithTooltip';
import { TextDropdown, type TextDropdownOption } from './TextDropdown';

type FilterToolbarProps = {
  filters: Filters;
  onChange: (next: Filters) => void;
  counts: StatusCounts;
  dimensions: ReportDimensions;
  uiLocale: string;
};

function statusOptions(
  counts: StatusCounts,
  current: StatusView,
): TextDropdownOption[] {
  const statuses = STATUS_ORDER.filter(
    (status) => counts[status] > 0 || status === current,
  );
  return [
    { value: 'attention', label: 'Needs attention', count: counts.attention },
    {
      value: 'all',
      label: 'All URLs',
      count: counts.all,
      separatorAfter: statuses.length > 0,
    },
    ...statuses.map((status) => ({
      value: status,
      label: STATUS_META[status].label,
      count: counts[status],
    })),
  ];
}

function modelOptions(
  models: ReportDimensions['models'],
): TextDropdownOption[] {
  return [
    { value: '', label: 'All models', separatorAfter: models.length > 0 },
    ...models.map((model) => ({ value: model.id, label: model.name })),
  ];
}

function localeOptions(
  locales: readonly string[],
  uiLocale: string,
): TextDropdownOption[] {
  const named = locales
    .map((code) => ({ value: code, label: localeName(code, uiLocale) }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale));
  return [
    { value: '', label: 'All locales', separatorAfter: named.length > 0 },
    ...named,
  ];
}

/** A picker holding a filter stays visible in a narrow pane. */
function pickerClass(name: string, value: string) {
  return value ? `${name} blc-filter--set` : name;
}

/**
 * The second 60px header row: search, then textual pickers, then "Clear filters".
 * A narrow pane drops the Model and Locale pickers rather than wrap; one that
 * holds a filter stays, on a second line if it must.
 */
export function FilterToolbar({
  filters,
  onChange,
  counts,
  dimensions,
  uiLocale,
}: FilterToolbarProps) {
  return (
    <Toolbar style={{ flex: 'none', minHeight: 60, borderTop: 0 }}>
      <ToolbarStack
        stackSize="s"
        className="blc-filter-row"
        style={{ minWidth: 0, justifyContent: 'flex-start' }}
      >
        <div className="dl-search blc-search">
          <Icon icon={faMagnifyingGlass} className="dl-search__icon" />
          <TextInput
            id="blc-search"
            labelText="Search URLs"
            placeholder="Search URLs…"
            value={filters.query}
            onChange={(query) => onChange({ ...filters, query })}
          />
          {filters.query && (
            <button
              type="button"
              className="dl-search__clear"
              aria-label="Clear search"
              onClick={() => onChange({ ...filters, query: '' })}
            >
              <Icon icon={faXmark} />
            </button>
          )}
        </div>
        <TextDropdown
          name="Status"
          value={filters.status}
          options={statusOptions(counts, filters.status)}
          onChange={(status) =>
            onChange({ ...filters, status: status as StatusView })
          }
          uiLocale={uiLocale}
        />
        {dimensions.models.length > 1 && (
          <div className={pickerClass('blc-filter-model', filters.modelId)}>
            <TextDropdown
              name="Model"
              value={filters.modelId}
              options={modelOptions(dimensions.models)}
              onChange={(modelId) => onChange({ ...filters, modelId })}
              uiLocale={uiLocale}
            />
          </div>
        )}
        {dimensions.locales.length > 1 && (
          <div className={pickerClass('blc-filter-locale', filters.locale)}>
            <TextDropdown
              name="Locale"
              value={filters.locale}
              options={localeOptions(dimensions.locales, uiLocale)}
              onChange={(locale) => onChange({ ...filters, locale })}
              uiLocale={uiLocale}
            />
          </div>
        )}
        <div style={{ flex: 1 }} />
        {!isDefaultFilters(filters) && (
          <WithTooltip content="Clear filters">
            <button
              type="button"
              className="dl-icon-button"
              aria-label="Clear filters"
              onClick={() => onChange(DEFAULT_FILTERS)}
            >
              <Icon icon={faXmark} />
            </button>
          </WithTooltip>
        )}
      </ToolbarStack>
    </Toolbar>
  );
}
