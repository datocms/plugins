import { Spinner } from 'datocms-react-ui';
import type { Ref } from 'react';
import { Button } from '../../ui/Button';
import { DisabledWithReason } from '../../ui/DisabledWithReason';
import type { PrimaryView } from '../contract';
import { type Copy, STRINGS } from './copy';

type PrimarySlotProps = {
  primary: PrimaryView;
  copy: Copy;
  /** Opens the confirm (the only way to write). */
  onReplace: () => void;
  onSearchAgain: () => void;
  /** Opens the publish confirm. */
  onPublish: () => void;
  /** The slot wrapper, for moving the focus to whatever the slot holds. */
  slotRef?: Ref<HTMLSpanElement>;
};

function BusyLabel() {
  return (
    <>
      <span className="fr-sr-only">{STRINGS.inProgress}</span>
      <span className="fr-button-spinner">
        <Spinner size={20} placement="centered" />
      </span>
    </>
  );
}

function SlotContent({
  primary,
  copy,
  onReplace,
  onSearchAgain,
  onPublish,
}: Omit<PrimarySlotProps, 'slotRef'>) {
  if (primary.kind === 'searchAgain') {
    return (
      <>
        <Button buttonSize="s" onClick={onSearchAgain}>
          {STRINGS.searchAgain}
        </Button>
        {primary.publish && (
          <Button buttonType="primary" buttonSize="s" onClick={onPublish}>
            {copy.publishLabel(primary.publish.recordCount)}
          </Button>
        )}
      </>
    );
  }

  if (primary.kind === 'publishing') {
    return (
      <DisabledWithReason reason={STRINGS.publishingReason}>
        <Button
          buttonType="primary"
          buttonSize="s"
          disabled
          style={{ pointerEvents: 'none' }}
        >
          {copy.publishLabel(primary.count)}
          <BusyLabel />
        </Button>
      </DisabledWithReason>
    );
  }

  if (primary.enabled) {
    return (
      <Button buttonType="primary" buttonSize="s" onClick={onReplace}>
        {copy.primaryLabel(primary.verb, primary.count)}
      </Button>
    );
  }

  return (
    <DisabledWithReason
      reason={copy.disabledReason(primary.reason, primary.verb)}
    >
      <Button
        buttonType="primary"
        buttonSize="s"
        disabled
        style={{ pointerEvents: 'none' }}
      >
        {primary.busy
          ? copy.primaryLabel(primary.verb, primary.count)
          : copy.primaryIdleLabel(primary.verb)}
        {primary.busy && <BusyLabel />}
      </Button>
    </DisabledWithReason>
  );
}

/**
 * The slot at the far right of the title toolbar: the solid primary
 * (enabled, disabled with a reason, or busy) or, after a finished run, a soft
 * "Search again" in its place, followed by a solid "Publish N records" when
 * replaced records can be published.
 */
export function PrimarySlot({ slotRef, ...props }: PrimarySlotProps) {
  return (
    <span ref={slotRef} className="fr-slot">
      <SlotContent {...props} />
    </span>
  );
}
