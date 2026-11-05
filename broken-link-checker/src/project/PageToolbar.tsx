import { Dropdown } from 'datocms-react-ui/Dropdown';
import Pane, { type ListPresetOption } from 'datocms-react-ui/Pane';
import SplitButton from 'datocms-react-ui/SplitButton';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useLayoutEffect, useRef } from 'react';
import { README_URL } from '../constants';
import {
  STATUS_ORDER,
  type StatusCounts,
  type StatusView,
} from '../report/view';
import { TEXTS } from '../texts';
import { STATUS_META } from '../ui/LogStatus';
import styles from './Report.module.css';

export type PageToolbarMode = 'idle' | 'scanning' | 'rechecking';

/**
 * `none`: a settled report with no URLs; `waiting`: a running scan has no URL
 * yet; `preparing`: a CSV is being written.
 */
export type ExportState = 'ready' | 'none' | 'waiting' | 'preparing';

/**
 * The page's texts for the kit: the plugin's own, and the first option of the
 * title's menu, every link whatever its status, which reads "All links". A
 * constant, so the Canvas that takes it doesn't render again.
 */
export const REPORT_TEXTS = { ...TEXTS, 'admin.listPresets.all': 'All links' };

const RECHECK_BLOCKS_SCAN = {
  reason: "You can't start a scan while a link is being rechecked.",
};
const RECHECK_BLOCKS_SCOPE = {
  reason: "You can't choose what to scan while a link is being rechecked.",
};
/** Why the export can't run now. */
const EXPORT_DISABLED: Record<ExportState, { reason: string } | undefined> = {
  ready: undefined,
  // A settled report with no URL has no export option at all.
  none: undefined,
  waiting: { reason: 'The report has no links to export yet.' },
  preparing: { reason: 'The CSV is being prepared.' },
};

/** A view the title's menu gives back by its id; null is "All links". */
function isStatusView(id: string | null): id is StatusView {
  return id === 'attention' || STATUS_ORDER.some((status) => status === id);
}

/**
 * The views of the title's menu after "All links", which the kit puts first:
 * "Needs attention" (the default), then each status in severity order. A
 * view that keeps no URL shows only while it's picked, as the kit's own
 * presets do (useListPresets), so the default view is there at first even
 * with no URL.
 */
function presetsFor(
  counts: StatusCounts,
  current: StatusView,
): ListPresetOption[] {
  const views: ListPresetOption[] = [
    {
      id: 'attention',
      label: 'Needs attention',
      shortLabel: 'Needs attention',
      count: counts.attention,
    },
    ...STATUS_ORDER.map((status) => ({
      id: status,
      label: STATUS_META[status].label,
      shortLabel: STATUS_META[status].label,
      count: counts[status],
    })),
  ];
  return views.filter((view) => view.count > 0 || view.id === current);
}

/**
 * A mode change swaps the scan action (the split "Scan links", or "Cancel
 * scan"), and a disabled reason wraps the control in its tooltip, which
 * remounts it; a new scan remounts the whole toolbar. Keyboard focus on a
 * control that is gone would fall to <body>, so it moves to what now holds
 * the same place, and to "Cancel scan" when a scan starts. A pointer focuses
 * without `:focus-visible`: its focus isn't moved, so the action doesn't keep
 * a focused look after a click.
 */
function useToolbarFocus(mode: PageToolbarMode) {
  const actionRef = useRef<HTMLSpanElement>(null);
  const previous = useRef<PageToolbarMode | null>(null);
  // Read while rendering, before the commit replaces the focused control.
  const keyboardFocus = useRef<'action' | 'elsewhere' | null>(null);
  const active = document.activeElement;
  keyboardFocus.current = !active?.matches(':focus-visible')
    ? null
    : actionRef.current?.contains(active)
      ? 'action'
      : 'elsewhere';
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = mode;
    if (before === mode) return;
    const started = mode === 'scanning' && before !== 'scanning';
    const move =
      keyboardFocus.current === 'action' ||
      (started && keyboardFocus.current !== null);
    if (!move || !document.hasFocus()) return;
    if (document.activeElement !== document.body) return;
    // A control disabled with a reason stays focusable, so it explains why.
    actionRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')
      ?.focus();
  }, [mode]);
  return actionRef;
}

type PageToolbarProps = {
  mode: PageToolbarMode;
  /** The status view of the list. */
  status: StatusView;
  counts: StatusCounts;
  onStatusChange: (status: StatusView) => void;
  /** The rows in the current view ("248 links"); nothing when there are none. */
  countLabel?: string;
  exportState: ExportState;
  onExport: () => void;
  /**
   * The filter toggle, when the list has something to filter (from
   * useFilterToolbar). With `onOpen`, `F` and `/` open the row and focus its
   * text field.
   */
  filter?: { open: boolean; onToggle: () => void; onOpen: () => void };
  onScan: () => void;
  onChooseScope: () => void;
  onCancel: () => void;
};

/**
 * The title bar of the report, the kit's bar of a view pane: the title is the
 * menu of the status views with the page's help at its bottom, then the count
 * and the "⋮" with the export; the filter toggle (F) and the scan action sit
 * at the right end.
 */
export function PageToolbar({
  mode,
  status,
  counts,
  onStatusChange,
  countLabel,
  exportState,
  onExport,
  filter,
  onScan,
  onChooseScope,
  onCancel,
}: PageToolbarProps) {
  const actionRef = useToolbarFocus(mode);
  const rechecking = mode === 'rechecking';
  // A settled report with no URL has no view to pick and nothing to export:
  // the title is no menu and the "⋮" doesn't show.
  const noLinks = exportState === 'none';
  const views = noLinks ? [] : presetsFor(counts, status);

  return (
    <Pane.Header>
      <Pane.Header.Title
        level={1}
        help={
          <Toolbar.Help docsUrl={README_URL}>
            Finds broken website links in the saved records of this environment.
            Results stay only while this page is open, so export them as CSV to
            keep a copy.
          </Toolbar.Help>
        }
        presets={
          views.length > 0
            ? {
                options: views,
                value: status === 'all' ? null : status,
                onChange: (id) => onStatusChange(isStatusView(id) ? id : 'all'),
              }
            : undefined
        }
      >
        Link checker
      </Pane.Header.Title>
      <Pane.Header.Subtitle>{countLabel}</Pane.Header.Subtitle>
      <Pane.Header.Menu>
        {!noLinks && (
          <Dropdown.Option
            disabled={EXPORT_DISABLED[exportState]}
            onPick={onExport}
          >
            Export as CSV
          </Dropdown.Option>
        )}
      </Pane.Header.Menu>
      <Pane.Header.Button>
        {filter && (
          <Toolbar.FilterToggle
            pressed={filter.open}
            onClick={filter.onToggle}
            onOpen={filter.onOpen}
          />
        )}
        <span ref={actionRef} className={styles.action}>
          {mode === 'scanning' ? (
            <Toolbar.Button
              tone="soft"
              label="Cancel scan"
              onClick={onCancel}
            />
          ) : (
            <SplitButton
              tone="primary"
              label="Scan links"
              disabled={rechecking ? RECHECK_BLOCKS_SCAN : undefined}
              onClick={onScan}
              menu={{
                ariaLabel: 'More scan options',
                disabled: rechecking ? RECHECK_BLOCKS_SCOPE : undefined,
              }}
            >
              <Dropdown.Option onPick={onChooseScope}>
                Choose what to scan…
              </Dropdown.Option>
            </SplitButton>
          )}
        </span>
      </Pane.Header.Button>
    </Pane.Header>
  );
}
