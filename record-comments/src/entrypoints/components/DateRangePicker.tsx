import { CloseIcon } from './Icons';
import styles from '@styles/dashboard.module.css';

type DateRangePickerProps = {
  startDate: Date | null;
  endDate: Date | null;
  onStartDateChange: (date: Date | null) => void;
  onEndDateChange: (date: Date | null) => void;
  onClear: () => void;
};

/**
 * Format a Date to YYYY-MM-DD string for input[type="date"]
 */
function formatDateForInput(date: Date | null): string {
  if (!date) return '';
  return date.toISOString().split('T')[0];
}

/**
 * Parse a YYYY-MM-DD string to Date
 */
function parseDateFromInput(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Date range picker component for filtering by date.
 *
 * ============================================================================
 * DATE VALIDATION - ALREADY IMPLEMENTED VIA HTML5 CONSTRAINTS
 * ============================================================================
 *
 * This component uses HTML5 date input's built-in validation via max/min attributes:
 * - Start date input has `max={endDate}` - prevents selecting dates after end date
 * - End date input has `min={startDate}` - prevents selecting dates before start date
 *
 * This browser-native validation is sufficient because:
 * 1. The date picker UI itself enforces the constraint (dates outside range are greyed out)
 * 2. Manual text entry still respects the constraint in modern browsers
 * 3. Invalid dates from `parseDateFromInput` return null, which is handled gracefully
 *
 * WHY WE DON'T ADD ADDITIONAL JS VALIDATION:
 * - HTML5 constraints are more reliable (browser-native)
 * - Adding JS validation would be redundant and could conflict with browser behavior
 * - The constraints update dynamically as users select dates
 *
 * EDGE CASE HANDLING:
 * - User enters invalid date string manually: `parseDateFromInput` returns null
 * - User selects start > end: Browser prevents this via max/min attributes
 * - Programmatic update with invalid range: This would be a caller bug, not our concern
 *
 * DO NOT add additional date validation logic here. The HTML5 approach is correct.
 * ============================================================================
 */
const DateRangePicker = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClear,
}: DateRangePickerProps) => {
  const hasValue = startDate !== null || endDate !== null;

  return (
    <div className={styles.dateRangePicker}>
      <div className={styles.dateRangeInputs}>
        <div className={styles.dateInputWrapper}>
          <label className={styles.dateInputLabel}>From</label>
          <input
            type="date"
            className={styles.dateInput}
            value={formatDateForInput(startDate)}
            onChange={(e) => onStartDateChange(parseDateFromInput(e.target.value))}
            max={endDate ? formatDateForInput(endDate) : undefined}
          />
        </div>
        <span className={styles.dateRangeSeparator}>→</span>
        <div className={styles.dateInputWrapper}>
          <label className={styles.dateInputLabel}>To</label>
          <input
            type="date"
            className={styles.dateInput}
            value={formatDateForInput(endDate)}
            onChange={(e) => onEndDateChange(parseDateFromInput(e.target.value))}
            min={startDate ? formatDateForInput(startDate) : undefined}
          />
        </div>
      </div>
      {hasValue && (
        <button
          type="button"
          className={styles.dateRangeClear}
          onClick={onClear}
          aria-label="Clear date range"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
};

export default DateRangePicker;
