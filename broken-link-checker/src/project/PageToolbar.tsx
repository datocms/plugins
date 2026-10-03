import { faDownload, faFilter } from '@fortawesome/free-solid-svg-icons';
import { Toolbar, ToolbarStack, ToolbarTitle } from 'datocms-react-ui';
import { type CSSProperties, useLayoutEffect, useRef } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { DisabledReason, WithTooltip } from '../ui/WithTooltip';

/** `firstRun`: before the first scan the blank slate holds "Scan links", so the toolbar doesn't. */
export type PageToolbarMode =
  | 'none'
  | 'firstRun'
  | 'idle'
  | 'scanning'
  | 'rechecking';
export type ExportState = 'hidden' | 'enabled' | 'disabled' | 'preparing';

type PageToolbarProps = {
  mode: PageToolbarMode;
  /** The rows in the current view: "248 URLs" */
  countLabel?: string;
  /** The pane's width, once measured: narrow panes keep only what fits beside the title. */
  paneWidth?: number;
  exportState?: ExportState;
  iconOnlyExport?: boolean;
  onScan?: () => void;
  onChooseScope?: () => void;
  onCancel?: () => void;
  onExport?: () => void;
};

const BLOCKED: CSSProperties = { pointerEvents: 'none' };
const CHOOSE_SCOPE = 'Choose what to scan…';

/**
 * The title is the last thing to give way. Below 700px "Choose what to scan…"
 * keeps only its icon; below 560px the count goes, and so does the scope
 * button while a scan runs (it's disabled then, and "Cancel scan" is wider).
 */
const ICON_ONLY_SCOPE_BELOW = 700;
const NARROW_BELOW = 560;

const isBelow = (width: number | undefined, limit: number) =>
  width !== undefined && width < limit;

function ExportButton({
  state,
  iconOnly,
  onExport,
}: {
  state: ExportState;
  iconOnly: boolean;
  onExport?: () => void;
}) {
  if (state === 'hidden') return null;
  const disabled = state === 'disabled' || state === 'preparing';
  const button = (
    <Button
      buttonSize="s"
      leftIcon={
        iconOnly ? <Icon icon={faDownload} title="Export CSV" /> : undefined
      }
      disabled={disabled}
      aria-busy={state === 'preparing' || undefined}
      style={disabled ? BLOCKED : undefined}
      onClick={onExport}
    >
      {iconOnly ? undefined : 'Export CSV'}
    </Button>
  );
  if (disabled)
    return (
      <DisabledReason
        reason={
          state === 'preparing'
            ? 'The CSV report is being prepared'
            : 'You cannot export the report as it has no URLs'
        }
      >
        {button}
      </DisabledReason>
    );
  return iconOnly ? (
    <WithTooltip content="Export CSV">{button}</WithTooltip>
  ) : (
    button
  );
}

/**
 * Opens the scope modal, which starts a scan; the summary names the scope a
 * report covers. While a scan or recheck runs the button stays, disabled with
 * its reason (a narrow pane drops it during a scan).
 */
function ChooseScopeButton({
  compact,
  blockedReason,
  onChooseScope,
}: {
  compact: boolean;
  blockedReason: string | null;
  onChooseScope?: () => void;
}) {
  const blocked = blockedReason !== null;
  const button = (
    <Button
      buttonSize="s"
      leftIcon={
        <Icon icon={faFilter} title={compact ? CHOOSE_SCOPE : undefined} />
      }
      disabled={blocked}
      style={blocked ? BLOCKED : undefined}
      onClick={onChooseScope}
    >
      {compact ? undefined : CHOOSE_SCOPE}
    </Button>
  );
  if (blocked)
    return <DisabledReason reason={blockedReason}>{button}</DisabledReason>;
  return compact ? (
    <WithTooltip content="Choose what to scan">{button}</WithTooltip>
  ) : (
    button
  );
}

function scopeBlockedReason(mode: PageToolbarMode): string | null {
  if (mode === 'scanning')
    return 'You cannot choose what to scan while a scan is running';
  if (mode === 'rechecking')
    return 'You cannot choose what to scan while a URL is being rechecked';
  return null;
}

function ScanButton({
  blocked,
  onScan,
}: {
  blocked: boolean;
  onScan?: () => void;
}) {
  const button = (
    <Button
      buttonType="primary"
      buttonSize="s"
      disabled={blocked}
      style={blocked ? BLOCKED : undefined}
      onClick={onScan}
    >
      Scan links
    </Button>
  );
  if (!blocked) return button;
  return (
    <DisabledReason reason="You cannot start a scan while a URL is being rechecked">
      {button}
    </DisabledReason>
  );
}

type FocusSlot = 'scope' | 'action';

/**
 * A mode change swaps the scan action (Scan links or Cancel scan) and switches
 * the other controls between enabled and disabled-with-a-reason, which
 * remounts them; a new scan remounts the whole toolbar. Focus on a control
 * that's gone would fall to <body>, so it moves to whatever now sits in the
 * same place, and to the new action when a scan starts.
 */
function useToolbarFocus(mode: PageToolbarMode) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const previous = useRef<PageToolbarMode | null>(null);
  // Read while rendering, before the commit replaces the focused control.
  const focusedSlot = useRef<FocusSlot | null>(null);
  const active = document.activeElement;
  focusedSlot.current = scopeRef.current?.contains(active)
    ? 'scope'
    : actionRef.current?.contains(active)
      ? 'action'
      : null;
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = mode;
    if (before === mode) return;
    const slot =
      focusedSlot.current ??
      (mode === 'scanning' && before !== 'scanning' ? 'action' : null);
    if (!slot || !document.hasFocus()) return;
    if (document.activeElement !== document.body) return;
    const wrapper = slot === 'scope' ? scopeRef.current : actionRef.current;
    // A disabled control takes focus through its tooltip anchor.
    wrapper
      ?.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')
      ?.focus();
  }, [mode]);
  return { scopeRef, actionRef };
}

/** Title ── space ── [count] [Choose what to scan…] [Export CSV] [Scan links or Cancel scan] */
export function PageToolbar({
  mode,
  countLabel,
  paneWidth,
  exportState = 'hidden',
  iconOnlyExport = false,
  onScan,
  onChooseScope,
  onCancel,
  onExport,
}: PageToolbarProps) {
  const { scopeRef, actionRef } = useToolbarFocus(mode);
  const narrow = isBelow(paneWidth, NARROW_BELOW);
  const showScope = mode !== 'none' && !(narrow && mode === 'scanning');
  return (
    <Toolbar style={{ flex: 'none', minHeight: 60 }}>
      <ToolbarStack
        stackSize="s"
        style={{ gap: 'var(--spacing-m)', minWidth: 0 }}
      >
        <ToolbarTitle className="dl-toolbar__title">
          <h1 className="blc-heading">Link checker</h1>
        </ToolbarTitle>
        <div style={{ flex: 1 }} />
        {countLabel && !narrow && (
          <span className="dl-toolbar__subtitle blc-toolbar-count">
            {countLabel}
          </span>
        )}
        {showScope && (
          <div ref={scopeRef} style={{ display: 'contents' }}>
            <ChooseScopeButton
              compact={isBelow(paneWidth, ICON_ONLY_SCOPE_BELOW)}
              blockedReason={scopeBlockedReason(mode)}
              onChooseScope={onChooseScope}
            />
          </div>
        )}
        <ExportButton
          state={exportState}
          iconOnly={iconOnlyExport}
          onExport={onExport}
        />
        <div ref={actionRef} style={{ display: 'contents' }}>
          {mode === 'scanning' && (
            <Button buttonSize="s" onClick={onCancel}>
              Cancel scan
            </Button>
          )}
          {(mode === 'idle' || mode === 'rechecking') && (
            <ScanButton blocked={mode === 'rechecking'} onScan={onScan} />
          )}
        </div>
      </ToolbarStack>
    </Toolbar>
  );
}
