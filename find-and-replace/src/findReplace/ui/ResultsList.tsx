import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { type RecordView, UI_LIMITS } from '../contract';
import { STRINGS } from './copy';
import { hasMatchChecks, RecordRow } from './RecordRow';

type ResultsListProps = {
  records: ReadonlyArray<RecordView>;
  selecting: boolean;
  selectionDisabled: boolean;
  runActive: boolean;
};

/**
 * The results card: 50 records at a time, "Load more records" renders the next
 * 50 from memory. Mount it keyed by `search.resultsId` so a new result set
 * starts from the first chunk with every record collapsed.
 */
export function ResultsList({
  records,
  selecting,
  selectionDisabled,
  runActive,
}: ResultsListProps) {
  const [chunks, setChunks] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef<number | null>(null);
  const rendered = Math.min(records.length, chunks * UI_LIMITS.recordsPerChunk);
  const shown = records.slice(0, rendered);
  const classes = [
    'fr-results',
    selecting ? 'fr-results--selecting' : null,
    // The checkbox column is reserved on every line only when a record shown has match checkboxes.
    shown.some((record) => hasMatchChecks(record, selecting))
      ? 'fr-results--match-checks'
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  // "Load more records" moves the focus to the first record it rendered.
  useEffect(() => {
    const index = focusIndexRef.current;
    if (index === null) {
      return;
    }
    focusIndexRef.current = null;
    const node = listRef.current?.children.item(index);
    if (node instanceof HTMLElement) {
      node.focus();
    }
  });

  return (
    <div ref={listRef} className={classes}>
      {shown.map((record) => (
        <RecordRow
          key={record.key}
          record={record}
          selecting={selecting}
          selectionDisabled={selectionDisabled}
          runActive={runActive}
        />
      ))}
      {rendered < records.length && (
        <div className="fr-results__more">
          <Button
            buttonSize="xs"
            onClick={() => {
              focusIndexRef.current = rendered;
              setChunks((count) => count + 1);
            }}
          >
            {STRINGS.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
