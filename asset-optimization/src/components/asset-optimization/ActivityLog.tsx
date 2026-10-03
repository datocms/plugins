import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import s from '../../entrypoints/styles.module.css';
import { formatFileSize } from '../../utils/formatters';
import { getVisibleActivityLog } from './presentation';

/**
 * Interface for log entries in the activity log
 */
export interface LogEntry {
  id?: number;
  text: string;
  originalSize?: number;
  optimizedSize?: number;
  savingsPercentage?: number;
}

/**
 * Props for the ActivityLog component
 */
interface ActivityLogProps {
  log: LogEntry[];
  droppedLogCount?: number;
}

/**
 * ActivityLog component displays a log of optimization activities
 *
 * This component displays log entries in reverse chronological order
 * (newest logs at the top) as per the user's preference.
 *
 * @param log - Array of log entries to display
 * @returns Rendered component or null if no logs are present
 */
const ActivityLog = ({
  log,
  droppedLogCount = 0,
}: ActivityLogProps): ReactElement | null => {
  // Create a ref for the logs container
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const entryKeys = useRef(new WeakMap<LogEntry, number>());
  const nextEntryKey = useRef(0);

  const getEntryKey = (entry: LogEntry): string => {
    if (entry.id !== undefined) return `log-${entry.id}`;
    let key = entryKeys.current.get(entry);
    if (key === undefined) {
      key = nextEntryKey.current++;
      entryKeys.current.set(entry, key);
    }
    return `entry-${key}`;
  };

  // Auto-scroll to the bottom whenever logs are updated
  useEffect(() => {
    if (logsContainerRef.current) {
      const { scrollHeight, clientHeight } = logsContainerRef.current;
      logsContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, []);

  if (log.length === 0) return null;

  const { entries, totalEntries, omittedEntries } = getVisibleActivityLog(
    log,
    droppedLogCount,
  );

  return (
    <div className={s.logWrapper}>
      <div className={s.logHeader}>
        <h3>Activity Log</h3>
        <span>
          {omittedEntries > 0
            ? `Latest ${entries.length} of ${totalEntries} entries`
            : `${entries.length} entries`}
        </span>
      </div>
      <div className={s.logsContainer} ref={logsContainerRef}>
        <div className={s.logs}>
          {entries.map((entry) => (
            <div key={getEntryKey(entry)} className={s.logEntry}>
              <span>{entry.text}</span>
              {entry.originalSize && entry.optimizedSize && (
                <span className={s.sizeComparison}>
                  <span className={s.originalSize}>
                    {formatFileSize(entry.originalSize)}
                  </span>
                  <span className={s.sizeArrow}>→</span>
                  <span className={s.optimizedSize}>
                    {formatFileSize(entry.optimizedSize)}
                  </span>
                  <span className={s.sizeSavings}>
                    (-{entry.savingsPercentage}%)
                  </span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ActivityLog;
