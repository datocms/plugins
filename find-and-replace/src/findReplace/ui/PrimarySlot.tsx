import Toolbar from 'datocms-react-ui/Toolbar';
import type { Ref } from 'react';
import { ArrowsRotateIcon } from '../../icons';
import type { PrimaryView } from '../contract';
import { type Copy, STRINGS } from './copy';

/** The id of the page's Cmd/Ctrl + Enter action, which opens the replace confirm. */
export const REPLACE_ACTION_ID = 'replace';

/** The name and the keys of the replace action, in the tooltip of the enabled primary. */
const REPLACE_TOOLTIP = {
  action: REPLACE_ACTION_ID,
  placement: 'bottom',
} as const;

type PrimarySlotProps = {
  primary: PrimaryView;
  copy: Copy;
  /** Opens the confirm (the only way to write). */
  onReplace: () => void;
  onSearchAgain: () => void;
  /** Opens the publish confirm. */
  onPublish: () => void;
  /** The first button of the slot, for moving the focus to whatever the slot holds. */
  slotRef?: Ref<HTMLElement>;
  /**
   * A phone-width frame: next to "Publish N records", "Search again" shows
   * only its icon (its label is its name and tooltip), so both fit by the
   * title.
   */
  isPhone?: boolean;
};

function SlotButtons({
  primary,
  copy,
  onReplace,
  onSearchAgain,
  onPublish,
  slotRef,
  isPhone = false,
}: PrimarySlotProps) {
  switch (primary.kind) {
    case 'searchAgain':
      return (
        <>
          {isPhone && primary.publish ? (
            <Toolbar.Button
              ref={slotRef}
              tone="soft"
              iconOnly
              icon={ArrowsRotateIcon}
              label={STRINGS.searchAgain}
              onClick={onSearchAgain}
            />
          ) : (
            <Toolbar.Button
              ref={slotRef}
              tone="soft"
              label={STRINGS.searchAgain}
              onClick={onSearchAgain}
            />
          )}
          {primary.publish && (
            <Toolbar.Button
              tone="primary"
              label={copy.publishLabel(primary.publish.recordCount)}
              onClick={onPublish}
            />
          )}
        </>
      );
    case 'publishing':
      // Busy: the kit disables a busy button (Button: "busy … it is
      // disabled"), so its reason shows on hover only. The focus is on Stop
      // during the pass, and the progress row says what runs.
      return (
        <Toolbar.Button
          ref={slotRef}
          tone="primary"
          label={copy.publishLabel(primary.count)}
          busy
          disabled={{ reason: STRINGS.publishingReason }}
        />
      );
    case 'replace':
      if (primary.enabled) {
        return (
          <Toolbar.Button
            ref={slotRef}
            tone="primary"
            label={copy.primaryLabel(primary.verb, primary.count)}
            onClick={onReplace}
            tooltip={REPLACE_TOOLTIP}
          />
        );
      }
      // A run keeps the counted label with a spinner; otherwise the
      // primary waits without a count. Either way it says why: a waiting
      // primary keeps the focus with its reason; a busy one is disabled by the
      // kit (as the publishing one above), while the focus is on Stop.
      return (
        <Toolbar.Button
          ref={slotRef}
          tone="primary"
          label={
            primary.busy
              ? copy.primaryLabel(primary.verb, primary.count)
              : copy.primaryIdleLabel(primary.verb)
          }
          busy={primary.busy}
          disabled={{
            reason: copy.disabledReason(primary.reason, primary.verb),
          }}
        />
      );
  }
}

/**
 * The slot at the right end of the title bar: the primary (enabled, disabled
 * with a reason, or busy) or, after a finished run, a soft "Search again" in
 * its place, followed by a primary "Publish N records" when replaced records
 * can be published. The slot holds one primary at most. The page registers
 * the Cmd/Ctrl + Enter action (`REPLACE_ACTION_ID`): the enabled primary
 * shows its keys.
 */
export function PrimarySlot(props: PrimarySlotProps) {
  return (
    <Toolbar.Group gap="s">
      <SlotButtons {...props} />
    </Toolbar.Group>
  );
}
