import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Button, { type ButtonContent } from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import { LoadMoreChevron } from 'datocms-react-ui/Chevron';
import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';
import Pill from 'datocms-react-ui/Pill';
import Spinner from 'datocms-react-ui/Spinner';
import {
  type RowProps,
  type RowSelection,
  Table,
  type TableCheckboxes,
  type TableColumn,
  type TableFirstCell,
  type TableLayout,
  type TableSelectAll,
  useLocalStorageTableLayout,
} from 'datocms-react-ui/Table';
import StatusCell from 'datocms-react-ui/Table/cells/StatusCell';
import {
  type MouseEvent,
  memo,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { OpenInNewTabIcon } from '../../icons';
import {
  type FieldView,
  type FindReplaceController,
  type MatchView,
  type RecordLink,
  type RecordPublishStatus,
  type RecordRunStatus,
  type RecordView,
  type SelectionView,
  UI_LIMITS,
} from '../contract';
import { type Copy, STRINGS } from './copy';
import { useResultsEnv } from './ResultsEnv';
import styles from './ResultsTable.module.css';
import { Snippet } from './Snippet';

// ── Layout ──────────────────────────────────────────────────────────────────

/** Per viewer, in this browser. Plugins share the origin: the key starts with the plugin's name. */
const LAYOUT_KEY = 'find-and-replace.resultsTable';

/** The columns as they show before the user moves or resizes them. */
export const DEFAULT_LAYOUT: TableLayout = {
  columns: [
    { name: 'record', width: 3 },
    { name: 'match', width: 5 },
    { name: 'model', width: 2 },
    { name: 'status', width: 2 },
  ],
};

/**
 * Under 720px of frame width, the four columns don't fit. The kit would hide
 * the columns that don't fit and keep only the first, but the snippets, the
 * model and the status must stay: one column then holds everything (the
 * title with the model, the count and the status under it; the place with
 * the snippet under it). The user's layout stays as it is, for wider frames.
 */
export const COMPACT_TABLE_QUERY = '(max-width: 719.98px)';

/** The one column of a narrow frame. */
const COMPACT_LAYOUT: TableLayout = { columns: [{ name: 'record', width: 1 }] };

/*
 * The smallest widths of the four columns. They fit side by side from 720px
 * of frame width (about 590px for the cells, past the checkboxes and the
 * open button), so the kit never has to hide one there.
 */
const RECORD_MIN_WIDTH = 120;
const MATCH_MIN_WIDTH = 200;
const MODEL_MIN_WIDTH = 96;
const STATUS_MIN_WIDTH = 112;

/** The match lines sit one level under their record. */
const INDENTATION = 30;

/** The controls at the end of a record row: one micro icon button. */
const TRAILING_WIDTH = 48;

const ALWAYS_VISIBLE: TableCheckboxes = { alwaysVisible: true };

/** A record whose lines show: the toggle opens and closes them. */
function recordFirstCell(open: boolean, onToggle: () => void): TableFirstCell {
  return { expandable: { open, onToggle } };
}

/** A match line: a node of the tree, one level down (the table draws a dash). */
const MATCH_FIRST_CELL: TableFirstCell = { indentation: INDENTATION };

/** A line of the record that isn't a match (the reason, "Show fewer matches"). */
const RECORD_LINE_FIRST_CELL: TableFirstCell = {
  indentation: INDENTATION,
  prefix: null,
};

/** "Show N more matches": the load-more chevron in the place of the toggle. */
const SHOW_MORE_FIRST_CELL: TableFirstCell = {
  indentation: INDENTATION,
  prefix: <LoadMoreChevron />,
};

/** "Load more records", at the level of the records. */
const LOAD_MORE_FIRST_CELL: TableFirstCell = { prefix: <LoadMoreChevron /> };

// ── Rows ────────────────────────────────────────────────────────────────────

type RecordRowData = {
  kind: 'record';
  record: RecordView;
  /**
   * The included matches while only some are (the selection shows, or a
   * pass used it); else null.
   */
  included: number | null;
};

type MatchRowData = {
  kind: 'match';
  record: RecordView;
  field: FieldView;
  match: MatchView;
  /** The position of the match in its field. */
  index: number;
  /**
   * "Changes the URL" on a slug's first line, while the selection shows,
   * and after a pass on a slug it left out.
   */
  showChangesUrl: boolean;
};

export type ResultRow = RecordRowData | MatchRowData;

type VisibleField = { field: FieldView; matches: ReadonlyArray<MatchView> };

/** The first `limit` matches of the record in document order, grouped by field. */
export function visibleFields(
  fields: ReadonlyArray<FieldView>,
  limit: number,
): VisibleField[] {
  const visible: VisibleField[] = [];
  let left = limit;
  for (const field of fields) {
    if (left <= 0) {
      break;
    }
    const matches = field.matches.slice(0, left);
    left -= matches.length;
    if (matches.length > 0) {
      visible.push({ field, matches });
    }
  }
  return visible;
}

function countMatches(fields: ReadonlyArray<FieldView>): number {
  let count = 0;
  for (const field of fields) {
    count += field.matches.length;
  }
  return count;
}

/**
 * A pass gave the record a status: its lines show what the pass used, so
 * they keep the words of the selection after it (the report has none).
 */
function usedSelection(record: RecordView, ui: SelectionUi): boolean {
  return ui !== 'hidden' || record.status.kind !== 'untouched';
}

/**
 * The included matches of a record whose checkbox can't show it: only some
 * are included, while the selection shows or after a pass used it (the
 * kit's checkbox has no mixed state). Null otherwise: the count of every
 * match is enough.
 */
function partlyIncluded(record: RecordView, ui: SelectionUi): number | null {
  if (!usedSelection(record, ui) || record.inclusion !== 'some') {
    return null;
  }
  let count = 0;
  for (const field of record.fields) {
    for (const match of field.matches) {
      if (match.included) {
        count += 1;
      }
    }
  }
  return count;
}

/** A pass gave a record a status: the Status column has something to show. */
function hasStatus(records: ReadonlyArray<RecordView>): boolean {
  return records.some(
    (record) =>
      record.status.kind !== 'untouched' || record.publish.kind !== 'none',
  );
}

type SelectionUi = SelectionView['ui'];

const noop = () => {};

/**
 * Only the checkbox toggles a row. The kit row (no `to`, no `onOpen`) calls
 * `onSelect` for a click anywhere in it, but a double or triple click that
 * selects a word of a snippet, or a tap on "Changes the URL" to read why,
 * must never change what gets replaced. The kit passes the click: it counts
 * only when it hit the checkbox's cell (the box itself takes no pointer) or
 * the box (Space on the focused checkbox).
 */
function fromCheckbox(event: MouseEvent<HTMLElement>): boolean {
  const { target, currentTarget } = event;
  if (!(target instanceof Node) || target === currentTarget) {
    return false;
  }
  const checkbox = currentTarget.querySelector('input[type="checkbox"]');
  return checkbox !== null && target.contains(checkbox);
}

/*
 * In a table with checkboxes, the kit gives every row that has data a
 * checkbox: one without `selection` is unchecked and looks live, but does
 * nothing. Only rows without data (the reason, "Show more", "Load more")
 * keep the checkbox space empty, and their cells would need the table's own
 * list of shown columns, which changes with the frame width and the user's
 * layout. So a record or match line that can't change shows its inclusion in
 * a disabled checkbox: it states the fact, and nothing toggles it.
 */

/**
 * The record checkbox says whether the record takes part: checked while any
 * of its matches is included ("2 of 3 matches" says when only some are).
 * A click asks for the negated value: checked leaves the record out,
 * unchecked includes every match. A slug left out of a checked record is
 * included only from its own line, next to "Changes the URL". An attempted
 * record keeps its inclusion, disabled.
 */
function recordSelection(
  record: RecordView,
  ui: SelectionUi,
  controller: FindReplaceController,
): RowSelection | undefined {
  if (ui === 'hidden') {
    return undefined;
  }
  const selected = record.inclusion !== 'none';
  if (!record.selectable) {
    return { selected, onSelect: noop, disabled: true };
  }
  return {
    selected,
    onSelect: (event) => {
      if (fromCheckbox(event)) {
        controller.setRecordIncluded(record.key, record.inclusion === 'none');
      }
    },
    disabled: ui === 'disabled',
  };
}

/**
 * A match checkbox: live where the match is selectable (2+ matches, not
 * attempted); otherwise its inclusion, disabled. The lone match of a record
 * takes the record's own checkbox, so both boxes of that one choice are
 * live and agree.
 */
function matchSelection(
  record: RecordView,
  match: MatchView,
  ui: SelectionUi,
  controller: FindReplaceController,
): RowSelection | undefined {
  if (record.matchCount === 1) {
    return recordSelection(record, ui, controller);
  }
  if (ui === 'hidden') {
    return undefined;
  }
  if (!match.selectable) {
    return { selected: match.included, onSelect: noop, disabled: true };
  }
  return {
    selected: match.included,
    onSelect: (event) => {
      if (fromCheckbox(event)) {
        controller.setMatchIncluded(match.key, !match.included);
      }
    },
    disabled: ui === 'disabled',
  };
}

type RowWrapperProps = NonNullable<RowProps<ResultRow>['wrapperProps']>;

type MatchRowEntry = {
  data: MatchRowData;
  selection?: RowSelection;
  wrapperProps: RowWrapperProps;
};

/** The shown match lines of a record, with their checkboxes. */
function buildMatchRows(
  record: RecordView,
  shown: number,
  ui: SelectionUi,
  controller: FindReplaceController,
): MatchRowEntry[] {
  const rows: MatchRowEntry[] = [];
  for (const { field, matches } of visibleFields(record.fields, shown)) {
    for (const [index, match] of matches.entries()) {
      rows.push({
        data: {
          kind: 'match',
          record,
          field,
          match,
          index,
          // In the report, a slug the pass left out still shows the old
          // text: the pill says why.
          showChangesUrl:
            index === 0 &&
            field.changesUrl &&
            usedSelection(record, ui) &&
            (ui !== 'hidden' || !match.included),
        },
        selection: matchSelection(record, match, ui, controller),
        wrapperProps: { 'data-match': match.key },
      });
    }
  }
  return rows;
}

/** The id of a record row's wrapper: "Load more records" focuses it. */
function recordRowId(prefix: string, recordKey: string): string {
  return `${prefix}record-${recordKey}`;
}

// ── Cells ───────────────────────────────────────────────────────────────────

function WhereCell({ row, copy }: { row: MatchRowData; copy: Copy }) {
  const { field } = row;
  return (
    <div className={styles.where}>
      {/* Every line keeps its place as its name: the row checkbox reads it,
          with a comma before the pill ("Slug, match 1, Changes the URL").
          Every line shows the place too, so the later lines of a field
          don't look empty. */}
      <span className="visually-hidden">
        {copy.whereName(
          field.path,
          field.locale,
          row.index,
          field.matches.length,
        )}
        {row.showChangesUrl && ', '}
      </span>
      <span aria-hidden="true">
        {copy.whereLabel(field.path, field.locale)}
      </span>
      {row.showChangesUrl && (
        <Pill tooltip={STRINGS.changesUrlTip}>{STRINGS.changesUrl}</Pill>
      )}
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <span className={styles.busy}>
      <Spinner inline label={false} />
      {label}
    </span>
  );
}

function RecordStatus({
  status,
  publish,
  copy,
}: {
  status: RecordRunStatus;
  publish: RecordPublishStatus;
  copy: Copy;
}) {
  // Publishing comes after a successful write, so it replaces "Replaced".
  if (publish.kind === 'publishing') {
    return <Busy label={STRINGS.publishing} />;
  }
  if (publish.kind === 'published') {
    return <StatusCell tone="success">{STRINGS.published}</StatusCell>;
  }
  // The text was replaced, but the record isn't live: the reason is under it.
  if (publish.kind === 'failed') {
    return <StatusCell tone="danger">{STRINGS.notPublished}</StatusCell>;
  }
  if (publish.kind === 'skipped') {
    return <StatusCell tone="warning">{STRINGS.notPublished}</StatusCell>;
  }
  switch (status.kind) {
    case 'untouched':
      return null;
    case 'writing':
      return <Busy label={STRINGS.updating} />;
    case 'replaced':
      return (
        <StatusCell tone="success">{copy.statusWord('replaced')}</StatusCell>
      );
    case 'skipped':
      return (
        <StatusCell tone="warning">{copy.statusWord('skipped')}</StatusCell>
      );
    case 'failed':
      return <StatusCell tone="danger">{copy.statusWord('failed')}</StatusCell>;
  }
}

/**
 * The one cell of a record or a match line on a narrow frame. A record:
 * its title, then "Article · 3 matches" ("2 of 3 matches" when only some are
 * included), then its status. A match line: its place, then the snippet.
 */
function CompactCell({ row, copy }: { row: ResultRow; copy: Copy }) {
  if (row.kind === 'match') {
    return (
      <div className={styles.stack}>
        <WhereCell row={row} copy={copy} />
        <Snippet match={row.match} />
      </div>
    );
  }
  const { record } = row;
  return (
    <div className={styles.stack}>
      <span className={styles.title}>
        {copy.recordTitle(record.title, record.recordId)}
      </span>
      <span className={styles.subtle}>
        {`${record.modelName} · ${copy.recordMatches(record.matchCount, row.included)}`}
      </span>
      <RecordStatus
        status={record.status}
        publish={record.publish}
        copy={copy}
      />
    </div>
  );
}

function useColumns(
  copy: Copy,
  compact: boolean,
  showStatus: boolean,
): TableColumn<ResultRow>[] {
  return useMemo<TableColumn<ResultRow>[]>(
    () =>
      compact
        ? [
            {
              name: 'record',
              label: STRINGS.recordColumn,
              truncate: false,
              renderCell: (row) => <CompactCell row={row} copy={copy} />,
            },
          ]
        : wideColumns(copy, showStatus),
    [copy, compact, showStatus],
  );
}

/**
 * Record, Match, Model and, once a pass gave a record a status, Status: on
 * a narrow table, Model goes first, then Status.
 */
function wideColumns(
  copy: Copy,
  showStatus: boolean,
): TableColumn<ResultRow>[] {
  const columns: TableColumn<ResultRow>[] = [
    {
      name: 'record',
      label: STRINGS.recordColumn,
      truncate: false,
      minWidth: RECORD_MIN_WIDTH,
      renderCell: (row) =>
        row.kind === 'record' ? (
          <span className={styles.title}>
            {copy.recordTitle(row.record.title, row.record.recordId)}
          </span>
        ) : (
          <WhereCell row={row} copy={copy} />
        ),
    },
    {
      name: 'match',
      label: STRINGS.matchColumn,
      truncate: false,
      minWidth: MATCH_MIN_WIDTH,
      priority: 2,
      renderCell: (row) =>
        row.kind === 'record' ? (
          <span className={styles.subtle}>
            {copy.recordMatches(row.record.matchCount, row.included)}
          </span>
        ) : (
          <Snippet match={row.match} />
        ),
    },
    {
      name: 'model',
      label: STRINGS.modelColumn,
      minWidth: MODEL_MIN_WIDTH,
      renderCell: (row) =>
        row.kind === 'record' ? row.record.modelName : null,
    },
  ];
  if (showStatus) {
    columns.push({
      name: 'status',
      label: STRINGS.statusColumn,
      minWidth: STATUS_MIN_WIDTH,
      priority: 1,
      renderCell: (row) =>
        row.kind === 'record' ? (
          <RecordStatus
            status={row.record.status}
            publish={row.record.publish}
            copy={copy}
          />
        ) : null,
    });
  }
  return columns;
}

/**
 * Opens the record, a page of the CMS. When the host knows the project's
 * domain, a link (a `to`: `Canvas` builds its `href` on that domain) that
 * opens in a new tab. Without that domain no URL of the page exists, and an
 * `href` of the bare path would resolve on the plugin's own origin (a middle
 * click or "Open in new tab" would open a broken page): a button then opens
 * it in the same tab through the host's router, locked while a pass runs (it
 * would leave the page). `labelled` shows its text, the same as the icon's
 * name: "Open record in a new tab" or "Open record".
 */
function OpenRecord({
  link,
  runActive,
  labelled = false,
}: {
  link: RecordLink;
  runActive: boolean;
  labelled?: boolean;
}) {
  const ctx = useCtx<RenderPageCtx>();
  const label =
    link.kind === 'href' ? STRINGS.openRecordNewTab : STRINGS.openRecord;
  const content: ButtonContent = labelled
    ? { icon: OpenInNewTabIcon, label }
    : { iconOnly: true, icon: OpenInNewTabIcon, label };

  if (link.kind === 'href') {
    return (
      <Button tone="ghost" size="micro" {...content} to={link.path} newTab />
    );
  }
  return (
    <Button
      tone="ghost"
      size="micro"
      {...content}
      onClick={() => {
        // Like a link: no spinner while the host opens the page.
        void ctx.navigateTo(link.path);
      }}
      disabled={runActive ? { reason: STRINGS.openRecordDisabled } : undefined}
    />
  );
}

// ── Lines of a record ───────────────────────────────────────────────────────

/**
 * A validation the record must pass, on save or on publish: the editor
 * fixes it in the record.
 */
function fixedInRecord(record: RecordView): boolean {
  const { status, publish } = record;
  return (
    (status.kind === 'failed' && status.reason === 'validation') ||
    (publish.kind === 'failed' && publish.reason === 'validation')
  );
}

/**
 * Why a record was skipped, failed, or not published, under its row. When
 * the editor fixes it in the record, "Open record" follows, always visible
 * (the row's own button shows only on hover or focus).
 */
function ReasonRow({ reason, open }: { reason: string; open: ReactNode }) {
  return (
    <Table.Row>
      <Table.Cell index={0} fill firstCell={RECORD_LINE_FIRST_CELL}>
        <div className={styles.actions}>
          <span className={styles.subtle}>{reason}</span>
          {open}
        </div>
      </Table.Cell>
    </Table.Row>
  );
}

type MoreMatchesRowProps = {
  total: number;
  shown: number;
  onShow: (count: number) => void;
};

/**
 * "Show N more matches" (up to 20 per click) and "Show fewer matches" (back
 * to 3). A record with one match more than 3 shows them all: no row. The
 * focus stays on the first button of the row.
 */
function MoreMatchesRow({ total, shown, onShow }: MoreMatchesRowProps) {
  const { copy } = useResultsEnv();
  const firstButton = useRef<HTMLElement>(null);
  const keepFocus = useRef(false);
  const atRest = UI_LIMITS.matchesAtRest;
  const remaining = total - shown;
  const expanded = shown > atRest && total > atRest + 1;

  useEffect(() => {
    if (keepFocus.current) {
      keepFocus.current = false;
      firstButton.current?.focus();
    }
  });

  if (remaining <= 0 && !expanded) {
    return null;
  }

  const show = (count: number) => {
    keepFocus.current = true;
    onShow(count);
  };

  return (
    <Table.Row>
      <Table.Cell
        index={0}
        fill
        firstCell={
          remaining > 0 ? SHOW_MORE_FIRST_CELL : RECORD_LINE_FIRST_CELL
        }
      >
        <div className={styles.actions}>
          {remaining > 0 && (
            <Button
              ref={firstButton}
              tone="ghost"
              size="micro"
              label={copy.showMore(
                Math.min(UI_LIMITS.matchesPerExpand, remaining),
              )}
              onClick={() => show(shown + UI_LIMITS.matchesPerExpand)}
            />
          )}
          {expanded && (
            <Button
              ref={remaining > 0 ? undefined : firstButton}
              tone="ghost"
              size="micro"
              label={STRINGS.showFewer}
              onClick={() => show(atRest)}
            />
          )}
        </div>
      </Table.Cell>
    </Table.Row>
  );
}

type RecordRowsProps = {
  record: RecordView;
  selectionUi: SelectionUi;
  /** A replace or publish pass runs: same-tab links would leave it. */
  runActive: boolean;
  idPrefix: string;
};

/**
 * One record: its row (title, match count, model, status, open), then its
 * lines while it is open (the default): the reason, the shown match lines,
 * and the row that shows more or fewer. The toggle of the record row closes
 * them. A record the snapshot didn't change keeps its identity, so it doesn't
 * render again.
 */
const RecordRows = memo(function RecordRows({
  record,
  selectionUi,
  runActive,
  idPrefix,
}: RecordRowsProps) {
  const { controller, copy } = useResultsEnv();
  const total = countMatches(record.fields);
  // "Show 1 more match" would take the place of the line it hides.
  const [shown, setShown] = useState<number>(() =>
    total <= UI_LIMITS.matchesAtRest + 1 ? total : UI_LIMITS.matchesAtRest,
  );
  const [open, setOpen] = useState(true);

  const row = useMemo<RecordRowData>(
    () => ({
      kind: 'record',
      record,
      included: partlyIncluded(record, selectionUi),
    }),
    [record, selectionUi],
  );
  const selection = useMemo(
    () => recordSelection(record, selectionUi, controller),
    [record, selectionUi, controller],
  );
  const wrapperProps = useMemo<RowWrapperProps>(
    () => ({
      id: recordRowId(idPrefix, record.key),
      tabIndex: -1,
      'data-record': record.key,
    }),
    [idPrefix, record.key],
  );
  const trailing = useMemo(
    () => (
      <OpenRecord
        link={controller.recordLink(record.key)}
        runActive={runActive}
      />
    ),
    [controller, record.key, runActive],
  );
  const matchRows = useMemo(
    () => buildMatchRows(record, shown, selectionUi, controller),
    [record, shown, selectionUi, controller],
  );
  const reason =
    copy.statusReason(record.status) ?? copy.publishReason(record.publish);
  const hasLines = reason !== null || matchRows.length > 0;
  const firstCell = useMemo(
    () =>
      hasLines
        ? recordFirstCell(open, () => setOpen((current) => !current))
        : undefined,
    [hasLines, open],
  );

  return (
    <>
      <Table.Row
        row={row}
        selection={selection}
        firstCell={firstCell}
        wrapperProps={wrapperProps}
        trailing={trailing}
      />
      {open && (
        <>
          {reason !== null && (
            <ReasonRow
              reason={reason}
              open={
                fixedInRecord(record) ? (
                  <OpenRecord
                    link={controller.recordLink(record.key)}
                    runActive={runActive}
                    labelled
                  />
                ) : null
              }
            />
          )}
          {matchRows.map((entry) => (
            <Table.Row
              key={entry.data.match.key}
              row={entry.data}
              selection={entry.selection}
              firstCell={MATCH_FIRST_CELL}
              wrapperProps={entry.wrapperProps}
            />
          ))}
          <MoreMatchesRow total={total} shown={shown} onShow={setShown} />
        </>
      )}
    </>
  );
});

// ── Table ───────────────────────────────────────────────────────────────────

function LoadMoreRow({ onLoad }: { onLoad: () => void }) {
  return (
    <Table.Row>
      <Table.Cell index={0} fill firstCell={LOAD_MORE_FIRST_CELL}>
        <Button
          tone="ghost"
          size="micro"
          label={STRINGS.loadMore}
          onClick={onLoad}
        />
      </Table.Cell>
    </Table.Row>
  );
}

type ResultsTableProps = {
  records: ReadonlyArray<RecordView>;
  selection: SelectionView;
  /** A replace or publish pass runs (running or stopping). */
  runActive: boolean;
  onSelectAll: (included: boolean) => void;
};

/**
 * The results, in the snapshot's order: a tree of records and their match
 * lines. 50 records at a time; "Load more records" renders the next 50 from
 * memory. Mount it keyed by `search.resultsId`, so a new result set starts
 * from the first chunk with every record at rest.
 */
export function ResultsTable({
  records,
  selection,
  runActive,
  onSelectAll,
}: ResultsTableProps) {
  const { copy } = useResultsEnv();
  const compact = useMediaQuery(COMPACT_TABLE_QUERY).matches;
  const showStatus = hasStatus(records);
  const columns = useColumns(copy, compact, showStatus);
  const [layout, setLayout] = useLocalStorageTableLayout(
    LAYOUT_KEY,
    DEFAULT_LAYOUT,
  );
  // Without its column, the table leaves Status out of the layouts it
  // reports: keep the saved one, so Status comes back where it was.
  const changeLayout = (next: TableLayout) => {
    const status = layout.columns.find((column) => column.name === 'status');
    const kept =
      !showStatus &&
      status !== undefined &&
      !next.columns.some((column) => column.name === 'status');
    setLayout(kept ? { columns: [...next.columns, status] } : next);
  };
  const [chunks, setChunks] = useState(1);
  const idPrefix = useId();
  const focusKey = useRef<string | null>(null);
  const rendered = Math.min(records.length, chunks * UI_LIMITS.recordsPerChunk);

  // "Load more records" moves the focus to the first record it rendered.
  useEffect(() => {
    const key = focusKey.current;
    if (key !== null) {
      focusKey.current = null;
      document.getElementById(recordRowId(idPrefix, key))?.focus();
    }
  });

  // The kit's select-all has no locked state: while a pass runs, it's left out.
  // Checked when every record row is: every record takes part.
  const selectAll = useMemo<TableSelectAll | undefined>(
    () =>
      selection.ui === 'enabled'
        ? {
            selected: records.every((record) => record.inclusion !== 'none'),
            onChange: onSelectAll,
          }
        : undefined,
    [selection.ui, records, onSelectAll],
  );

  const loadMore = () => {
    focusKey.current = records[rendered]?.key ?? null;
    setChunks((count) => count + 1);
  };

  return (
    <Table
      columns={columns}
      layout={compact ? COMPACT_LAYOUT : layout}
      onLayoutChange={compact ? noop : changeLayout}
      checkboxes={selection.ui === 'hidden' ? undefined : ALWAYS_VISIBLE}
      trailingWidth={TRAILING_WIDTH}
      tree
    >
      <Table.Header selectAll={selectAll} />
      <Table.Body>
        {records.slice(0, rendered).map((record) => (
          <RecordRows
            key={record.key}
            record={record}
            selectionUi={selection.ui}
            runActive={runActive}
            idPrefix={idPrefix}
          />
        ))}
        {rendered < records.length && <LoadMoreRow onLoad={loadMore} />}
      </Table.Body>
    </Table>
  );
}
