import type { CommentFilters, FilterOptions } from '@hooks/useCommentFilters';
import type { StyleWithCustomProps } from '@ctypes/styles';
import { useFilterOptionsTransform } from '@hooks/useFilterOptionsTransform';
import FilterDropdown from './FilterDropdown';
import styles from '@styles/dashboard.module.css';

type SearchFilterSidebarProps = {
  filters: CommentFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (filters: CommentFilters) => void;
  onClearAll: () => void;
  onApply: () => void;
  isFiltering: boolean;
  hasUnappliedChanges: boolean;
  accentColor: string;
};

/** Vertical filter sidebar for the Comments Dashboard. */
const SearchFilterSidebar = ({
  filters,
  filterOptions,
  onFiltersChange,
  onClearAll,
  onApply,
  isFiltering,
  hasUnappliedChanges,
  accentColor,
}: SearchFilterSidebarProps) => {
  const { authorOptions, recordOptions, assetOptions, modelOptions, userOptions } =
    useFilterOptionsTransform(filterOptions);

  const updateFilter = <K extends keyof CommentFilters>(key: K, value: CommentFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className={styles.filterSidebar}>
      <div className={styles.filterSidebarHeader}>
        <h3 className={styles.filterSidebarTitle}>Filters</h3>
      </div>

      <div className={styles.filterSidebarContent}>
        {/* Search Input */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>Search</label>
          <div className={styles.searchInputWrapperVertical}>
            <svg className={styles.searchIcon} viewBox="0 0 16 16" fill="currentColor">
              <title>Search</title>
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
            </svg>
            <input
              type="text"
              className={styles.searchInputVertical}
              placeholder="Search..."
              value={filters.searchQuery}
              onChange={(e) => updateFilter('searchQuery', e.target.value)}
            />
            {filters.searchQuery && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => updateFilter('searchQuery', '')}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <title>Clear</title>
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Date Range */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>Date Range</label>
          <div className={styles.dateRangeVertical}>
            <div className={styles.dateInputVerticalWrapper}>
              <span className={styles.dateInputVerticalLabel}>From</span>
              <input
                type="date"
                className={styles.dateInputVertical}
                value={filters.dateRange.start?.toISOString().split('T')[0] ?? ''}
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value) : null;
                  updateFilter('dateRange', { ...filters.dateRange, start: date });
                }}
                max={filters.dateRange.end?.toISOString().split('T')[0]}
              />
            </div>
            <div className={styles.dateInputVerticalWrapper}>
              <span className={styles.dateInputVerticalLabel}>To</span>
              <input
                type="date"
                className={styles.dateInputVertical}
                value={filters.dateRange.end?.toISOString().split('T')[0] ?? ''}
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value) : null;
                  updateFilter('dateRange', { ...filters.dateRange, end: date });
                }}
                min={filters.dateRange.start?.toISOString().split('T')[0]}
              />
            </div>
          </div>
        </div>

        {/* Author Filter */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>Author</label>
          <FilterDropdown
            label=""
            options={authorOptions}
            selectedValue={filters.authorEmail}
            onSelect={(value) => updateFilter('authorEmail', value)}
            placeholder="All authors"
            emptyMessage="No comments yet"
          />
        </div>

        {/* Record Mention Filter */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>Mentioned Record</label>
          <FilterDropdown
            label=""
            options={recordOptions}
            selectedValue={filters.mentionedRecordId}
            onSelect={(value) => updateFilter('mentionedRecordId', value)}
            placeholder="All records"
            emptyMessage="No record mentions yet"
          />
        </div>

        {/* Asset Mention Filter */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>Mentioned Asset</label>
          <FilterDropdown
            label=""
            options={assetOptions}
            selectedValue={filters.mentionedAssetId}
            onSelect={(value) => updateFilter('mentionedAssetId', value)}
            placeholder="All assets"
            emptyMessage="No asset mentions yet"
          />
        </div>

        {/* Model Mention Filter */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>Mentioned Model</label>
          <FilterDropdown
            label=""
            options={modelOptions}
            selectedValue={filters.mentionedModelId}
            onSelect={(value) => updateFilter('mentionedModelId', value)}
            placeholder="All models"
            emptyMessage="No model mentions yet"
          />
        </div>

        {/* User Mention Filter */}
        <div className={styles.filterSection}>
          <label className={styles.filterSectionLabel}>@Mentioned User</label>
          <FilterDropdown
            label=""
            options={userOptions}
            selectedValue={filters.mentionedUserEmail}
            onSelect={(value) => updateFilter('mentionedUserEmail', value)}
            placeholder="All users"
            emptyMessage="No user mentions yet"
          />
        </div>
      </div>

      {/* Footer with Clear and Apply buttons */}
      <div className={styles.filterSidebarFooter}>
        <button
          type="button"
          className={styles.clearFiltersButton}
          onClick={onClearAll}
          disabled={!isFiltering && !hasUnappliedChanges}
        >
          Clear Filters
        </button>
        <button
          type="button"
          className={styles.applyFiltersButton}
          onClick={onApply}
          disabled={!hasUnappliedChanges}
          style={{ '--accent-color': accentColor } as StyleWithCustomProps}
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};

export default SearchFilterSidebar;
