import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import s from '../../entrypoints/styles.module.css';
import { formatFileSize } from '../../utils/formatters';

/**
 * Interface for log entries in the activity log
 */
export interface LogEntry {
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
const ActivityLog = ({ log }: ActivityLogProps): ReactElement | null => {
  if (log.length === 0) return null;
  
  // Create a ref for the logs container
  const logsContainerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to the bottom whenever logs are updated
  useEffect(() => {
    if (logsContainerRef.current) {
      const { scrollHeight, clientHeight } = logsContainerRef.current;
      logsContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, []);
  
  return (
    <div className={s.logWrapper}>
      <div className={s.logHeader}>
        <h3>Activity Log</h3>
        <span>{log.length} entries</span>
      </div>
      <div className={s.logsContainer} ref={logsContainerRef}>
        <div className={s.logs}>
          {log.map((entry, i) => (
            <div key={`log-${i}-${entry.text.substring(0, 10)}`} className={s.logEntry}>
              <span>{entry.text}</span>
              {entry.originalSize && entry.optimizedSize && (
                <span className={s.sizeComparison}>
                  <span className={s.originalSize}>{formatFileSize(entry.originalSize)}</span>
                  <span className={s.sizeArrow}>&#8594;</span>
                  <span className={s.optimizedSize}>{formatFileSize(entry.optimizedSize)}</span>
                  <span className={s.sizeSavings}>(-{entry.savingsPercentage}%)</span>
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
