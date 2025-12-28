import { useState, useRef, useCallback } from 'react';
import type { CommentFilters, FilterOptions } from '@hooks/useCommentFilters';
import { useFilterOptionsTransform } from '@hooks/useFilterOptionsTransform';
import { useClickOutside } from '@hooks/useDropdown';
import FilterDropdown from './FilterDropdown';
import DateRangePicker from './DateRangePicker';
import { cn } from '@/utils/cn';
import styles from '@styles/dashboard.module.css';

type SearchFilterBarProps = {
  filters: CommentFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (filters: CommentFilters) => void;
  onClearAll: () => void;
  isFiltering: boolean;
  accentColor: string;
};

/**
 * Horizontal search and filter bar for comments.
 * Used for inline filtering in compact layouts.
 */
const SearchFilterBar = ({
  filters,
  filterOptions,
  onFiltersChange,
  onClearAll,
  isFiltering,
  accentColor,
}: SearchFilterBarProps) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreDropdownRef = useRef<HTMLDivElement>(null);

  // Close "More" dropdown when clicking outside
  // Uses the shared useClickOutside hook from useDropdown.ts
  const handleCloseMore = useCallback(() => {
    setIsMoreOpen(false);
  }, []);
  useClickOutside(moreDropdownRef, handleCloseMore);

  const { authorOptions, recordOptions, assetOptions, modelOptions, userOptions } =
    useFilterOptionsTransform(filterOptions);

  const updateFilter = <K extends keyof CommentFilters>(key: K, value: CommentFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  // Count total active filters
  const activeFilterCount = [
    filters.searchQuery.trim(),
    filters.authorEmail,
    filters.dateRange.start,
    filters.dateRange.end,
    filters.mentionedRecordId,
    filters.mentionedAssetId,
    filters.mentionedModelId,
    filters.mentionedUserEmail,
  ].filter(Boolean).length;

  // Count active secondary filters (in "More" dropdown)
  const secondaryFilterCount = [
    filters.mentionedModelId,
    filters.mentionedUserEmail,
  ].filter(Boolean).length;

  return (
    <div className={styles.searchFilterBar}>
      {/* Row 1: Search + Primary Filters */}
      <div className={styles.filterRow}>
        {/* Search Input */}
        <div className={styles.searchInputWrapper}>
          <svg
            className={styles.searchIcon}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <title>Search</title>
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search comments..."
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

        {/* Primary Filter Dropdowns */}
        <FilterDropdown
          label="Author"
          options={authorOptions}
          selectedValue={filters.authorEmail}
          onSelect={(value) => updateFilter('authorEmail', value)}
          placeholder="All authors"
          emptyMessage="No comments yet"
        />

        <FilterDropdown
          label="Record"
          options={recordOptions}
          selectedValue={filters.mentionedRecordId}
          onSelect={(value) => updateFilter('mentionedRecordId', value)}
          placeholder="All records"
          emptyMessage="No record mentions yet"
        />

        <FilterDropdown
          label="Asset"
          options={assetOptions}
          selectedValue={filters.mentionedAssetId}
          onSelect={(value) => updateFilter('mentionedAssetId', value)}
          placeholder="All assets"
          emptyMessage="No asset mentions yet"
        />

        {/* More Filters Dropdown */}
        <div className={styles.moreFiltersWrapper} ref={moreDropdownRef}>
          <button
            type="button"
            className={cn(styles.moreFiltersButton, secondaryFilterCount > 0 && styles.moreFiltersButtonActive)}
            onClick={() => setIsMoreOpen(!isMoreOpen)}
            aria-expanded={isMoreOpen}
          >
            More
            {secondaryFilterCount > 0 && (
              <span
                className={styles.filterBadge}
                style={{ backgroundColor: accentColor }}
              >
                {secondaryFilterCount}
              </span>
            )}
            <svg
              className={styles.filterDropdownChevron}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <title>Toggle</title>
              <path
                fillRule="evenodd"
                d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"
              />
            </svg>
          </button>

          {isMoreOpen && (
            <div className={styles.moreFiltersMenu}>
              <div className={styles.moreFiltersContent}>
                <FilterDropdown
                  label="Model"
                  options={modelOptions}
                  selectedValue={filters.mentionedModelId}
                  onSelect={(value) => updateFilter('mentionedModelId', value)}
                  placeholder="All models"
                  emptyMessage="No model mentions yet"
                />

                <FilterDropdown
                  label="@Mentioned User"
                  options={userOptions}
                  selectedValue={filters.mentionedUserEmail}
                  onSelect={(value) =>
                    updateFilter('mentionedUserEmail', value)
                  }
                  placeholder="All users"
                  emptyMessage="No user mentions yet"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Date Range + Clear All */}
      <div className={styles.filterRow}>
        <DateRangePicker
          startDate={filters.dateRange.start}
          endDate={filters.dateRange.end}
          onStartDateChange={(date) =>
            updateFilter('dateRange', { ...filters.dateRange, start: date })
          }
          onEndDateChange={(date) =>
            updateFilter('dateRange', { ...filters.dateRange, end: date })
          }
          onClear={() =>
            updateFilter('dateRange', { start: null, end: null })
          }
        />

        <div className={styles.filterRowSpacer} />

        {isFiltering && (
          <button
            type="button"
            className={styles.clearAllButton}
            onClick={onClearAll}
          >
            Clear all
            {activeFilterCount > 0 && (
              <span
                className={styles.filterBadge}
                style={{ backgroundColor: accentColor }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchFilterBar;
