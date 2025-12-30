import { CloseIcon } from './Icons';
import styles from '@styles/dashboard.module.css';

type DateRangePickerProps = {
  startDate: Date | null;
  endDate: Date | null;
  onStartDateChange: (date: Date | null) => void;
  onEndDateChange: (date: Date | null) => void;
  onClear: () => void;
};

function formatDateForInput(date: Date | null): string {
  if (!date) return '';
  return date.toISOString().split('T')[0];
}

function parseDateFromInput(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date range picker. Uses HTML5 min/max attributes for validation. */
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
