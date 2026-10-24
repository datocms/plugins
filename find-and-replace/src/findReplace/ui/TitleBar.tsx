import { Dropdown } from 'datocms-react-ui/Dropdown';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { ReactNode } from 'react';
import { ArrowsRotateIcon } from '../../icons';
import { type CalloutAction, STRINGS } from './copy';

/**
 * Under 600px of frame width the bar has no room for the meta after the
 * title: it shows above the results instead.
 */
export const NARROW_FRAME_QUERY = '(max-width: 599.98px)';

/** The "Try again" actions of the "⋮": they act on the callouts above the results. */
export type RetryOptions = {
  /** The retries that apply now, in menu order. With none, the "⋮" doesn't show. */
  actions: ReadonlyArray<CalloutAction>;
  /** False while a replacement or publishing pass runs: the options say why they wait. */
  enabled: boolean;
  onRetryRecords: () => void;
  onRetryModels: () => void;
};

type TitleBarProps = {
  /** "124 matches in 38 records", after the title. */
  meta?: string | null;
  /**
   * A frame under 600px wide: the bar keeps its room for the title and the
   * slot, and the meta shows above the results instead (see Body).
   */
  narrow?: boolean;
  retries?: RetryOptions;
  /** The primary slot, at the right end. */
  children?: ReactNode;
};

/** The options of the "⋮". A menu with one option has no icon; with two, both get one. */
function retryOptions(retries: RetryOptions): ReactNode {
  const { actions, enabled } = retries;
  const icon = actions.length > 1 ? <ArrowsRotateIcon /> : undefined;
  const disabled = enabled
    ? undefined
    : { reason: STRINGS.retryDisabledReason };

  return (
    <>
      {actions.includes('retryRecords') && (
        <Dropdown.Option
          icon={icon}
          disabled={disabled}
          onPick={retries.onRetryRecords}
        >
          {STRINGS.retryRecords}
        </Dropdown.Option>
      )}
      {actions.includes('retryModels') && (
        <Dropdown.Option
          icon={icon}
          disabled={disabled}
          onPick={retries.onRetryModels}
        >
          {STRINGS.retryModels}
        </Dropdown.Option>
      )}
    </>
  );
}

/**
 * The title bar of the page's view pane: the title (with its "?"), the meta,
 * the "⋮" with the retries, and the slot at the right end. The header puts
 * the parts in that order, and leaves out those that are falsy.
 */
export function TitleBar({
  meta = null,
  narrow = false,
  retries,
  children,
}: TitleBarProps) {
  const showMenu = retries !== undefined && retries.actions.length > 0;

  return (
    <Pane.Header>
      <Pane.Header.Title
        level={1}
        help={<Toolbar.Help>{STRINGS.help}</Toolbar.Help>}
      >
        {STRINGS.title}
      </Pane.Header.Title>
      {meta && !narrow && <Pane.Header.Subtitle>{meta}</Pane.Header.Subtitle>}
      {showMenu && <Pane.Header.Menu>{retryOptions(retries)}</Pane.Header.Menu>}
      {children && <Pane.Header.Button>{children}</Pane.Header.Button>}
    </Pane.Header>
  );
}
