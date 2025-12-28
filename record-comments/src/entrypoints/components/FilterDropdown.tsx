import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { cn } from '@/utils/cn';
import styles from '@styles/dashboard.module.css';

export type FilterOption = {
  value: string;
  label: string;
  sublabel?: string;
};

type FilterDropdownProps = {
  label: string;
  options: FilterOption[];
  selectedValue: string | null;
  onSelect: (value: string | null) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
};

/**
 * Reusable dropdown component for filter selections
 */
const FilterDropdown = ({
  label,
  options,
  selectedValue,
  onSelect,
  placeholder = 'All',
  searchable = true,
  disabled = false,
  emptyMessage = 'No options available',
}: FilterDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  // Close dropdown when clicking outside
  // NOTE: This component uses a direct event listener rather than the useClickOutside hook
  // from useDropdown.ts because closing the dropdown requires additional side effects:
  // resetting the search query state. The useClickOutside hook only supports a simple
  // callback and would require modification to handle this case. Since FilterDropdown
  // is a self-contained component with its own state management, the inline implementation
  // is clearer and avoids over-engineering the shared hook.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens and reset highlighted index
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(-1);
      if (searchable && searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
  }, [isOpen, searchable]);

  // Reset highlighted index when search changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [highlightedIndex]);

  // Filter options based on search query
  const filteredOptions = useMemo(
    () =>
      searchQuery
        ? options.filter(
            (opt) =>
              opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
              opt.sublabel?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : options,
    [searchQuery, options]
  );

  // Get selected option label
  const selectedOption = options.find((opt) => opt.value === selectedValue);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      if (!isOpen) {
        setSearchQuery('');
      }
    }
  };

  const handleSelect = (value: string | null) => {
    onSelect(value);
    setIsOpen(false);
    setSearchQuery('');
  };

  const hasOptions = options.length > 0;

  // Total options count: "All" option (index 0) + filtered options
  const totalOptions = hasOptions ? 1 + filteredOptions.length : 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (totalOptions > 0) {
          setHighlightedIndex((prev) =>
            prev < totalOptions - 1 ? prev + 1 : prev
          );
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;

      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && hasOptions) {
          if (highlightedIndex === 0) {
            // "All" option
            handleSelect(null);
          } else {
            // Regular option (index - 1 because "All" is at index 0)
            const option = filteredOptions[highlightedIndex - 1];
            if (option) {
              handleSelect(option.value);
            }
          }
        }
        break;

      case 'Tab':
        // Close dropdown on Tab to let focus move naturally
        setIsOpen(false);
        setSearchQuery('');
        break;
    }
  };

  return (
    <div
      className={cn(styles.filterDropdown, disabled && styles.filterDropdownDisabled)}
      ref={dropdownRef}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={cn(styles.filterDropdownTrigger, selectedValue && styles.filterDropdownActive)}
        onClick={handleToggle}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? menuId : undefined}
      >
        <span className={styles.filterDropdownLabel}>{label}</span>
        {selectedOption && (
          <span className={styles.filterDropdownValue}>
            {selectedOption.label}
          </span>
        )}
        <svg
          className={styles.filterDropdownChevron}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <title>Toggle dropdown</title>
          <path
            fillRule="evenodd"
            d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          id={menuId}
          className={styles.filterDropdownMenu}
          role="listbox"
          aria-label={`${label} options`}
        >
          {/* ACCESSIBILITY: The search input uses aria-label instead of a visible <label>
              because the placeholder "Search..." provides visual context, and a visible
              label would be redundant. aria-label is the WCAG-compliant way to provide
              an accessible name when a visible label isn't needed for sighted users. */}
          {searchable && options.length > 5 && (
            <div className={styles.filterDropdownSearch}>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.filterDropdownSearchInput}
                aria-label={`Search ${label} options`}
              />
            </div>
          )}

          <div className={styles.filterDropdownOptions}>
            {hasOptions ? (
              <>
                {/* "All" option to clear selection */}
                <button
                  ref={(el) => { optionRefs.current[0] = el; }}
                  type="button"
                  className={cn(
                    styles.filterDropdownOption,
                    selectedValue === null && styles.filterDropdownOptionSelected,
                    highlightedIndex === 0 && styles.filterDropdownOptionHighlighted
                  )}
                  onClick={() => handleSelect(null)}
                  onMouseEnter={() => setHighlightedIndex(0)}
                  role="option"
                  aria-selected={selectedValue === null}
                >
                  <span className={styles.filterDropdownOptionLabel}>
                    {placeholder}
                  </span>
                </button>

                {filteredOptions.map((option, index) => {
                  const optionIndex = index + 1; // +1 because "All" is at index 0
                  return (
                    <button
                      key={option.value}
                      ref={(el) => { optionRefs.current[optionIndex] = el; }}
                      type="button"
                      className={cn(
                        styles.filterDropdownOption,
                        selectedValue === option.value && styles.filterDropdownOptionSelected,
                        highlightedIndex === optionIndex && styles.filterDropdownOptionHighlighted
                      )}
                      onClick={() => handleSelect(option.value)}
                      onMouseEnter={() => setHighlightedIndex(optionIndex)}
                      role="option"
                      aria-selected={selectedValue === option.value}
                    >
                      <span className={styles.filterDropdownOptionLabel}>
                        {option.label}
                      </span>
                      {option.sublabel && (
                        <span className={styles.filterDropdownOptionSublabel}>
                          {option.sublabel}
                        </span>
                      )}
                    </button>
                  );
                })}

                {filteredOptions.length === 0 && searchQuery && (
                  <div className={styles.filterDropdownEmpty}>
                    No matches found
                  </div>
                )}
              </>
            ) : (
              <div className={styles.filterDropdownEmpty}>
                {emptyMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FilterDropdown;
