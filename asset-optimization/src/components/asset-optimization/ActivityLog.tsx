import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import { Page } from 'datocms-react-ui/Page';
import { formatFileSize } from '../../utils/formatters';
import { useFormatters } from '../../utils/useFormatters';
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

interface ActivityLogProps {
  log: LogEntry[];
  droppedLogCount?: number;
}

/** One line of the log, with the sizes of an optimized image */
function logLine(entry: LogEntry): string {
  if (!entry.originalSize || !entry.optimizedSize) return entry.text;
  return `${entry.text}  ${formatFileSize(entry.originalSize)} → ${formatFileSize(entry.optimizedSize)} (−${entry.savingsPercentage}%)`;
}

/**
 * The log of the run, newest first. It shows nothing while the log is empty.
 */
const ActivityLog = ({ log, droppedLogCount = 0 }: ActivityLogProps) => {
  const format = useFormatters();
  if (log.length === 0) return null;

  const { entries, totalEntries, omittedEntries } = getVisibleActivityLog(
    log,
    droppedLogCount,
  );
  const countText =
    omittedEntries > 0
      ? `Latest ${format.count(entries.length)} of ${format.count(totalEntries)} entries`
      : format.plural(entries.length, 'entry', 'entries');

  return (
    <Page.Group title="Activity log" footer={countText}>
      <CodeSnippet
        ariaLabel="Activity log"
        maxHeight={320}
        code={entries.map(logLine).join('\n')}
      />
    </Page.Group>
  );
};

export default ActivityLog;
