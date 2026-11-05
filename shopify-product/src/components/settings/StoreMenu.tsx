import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import { useRef } from 'react';
import { EllipsisVerticalIcon, StarIcon, TrashIcon } from '../../icons';
import { isFocusLost, SAVING_REASON } from './focus';

type Props = {
  /** The store's name, for the accessible name. */
  name: string;
  isDefault: boolean;
  /** A save is running: the menu waits for it. */
  busy: boolean;
  onMakeDefault: () => Promise<void>;
  onRemove: () => Promise<void>;
};

/**
 * The menu took focus, and a pick closes it without giving focus back (it
 * stays on the menu while it fades out, then drops to the page). Once the
 * action is done, focus goes back to the trigger, unless the action moved it
 * (Remove store focuses the neighbour) or removed the trigger with its store.
 */
function refocusTrigger(root: HTMLElement | null) {
  const trigger = root?.querySelector<HTMLElement>('[aria-haspopup]');
  if (!trigger?.isConnected) return;
  const menuId = trigger.getAttribute('aria-controls');
  const menu = menuId ? document.getElementById(menuId) : null;
  if (isFocusLost() || menu?.contains(document.activeElement)) {
    trigger.focus({ preventScroll: true });
  }
}

/** The "⋮" of a store item: Make default, then Remove store (last). */
export default function StoreMenu({
  name,
  isDefault,
  busy,
  onMakeDefault,
  onRemove,
}: Props) {
  const root = useRef<HTMLDivElement>(null);

  const run = (action: () => Promise<void>) => async () => {
    try {
      await action();
    } finally {
      refocusTrigger(root.current);
    }
  };

  return (
    <div ref={root}>
      <Dropdown
        triggerComponent={IconTrigger}
        icon={EllipsisVerticalIcon}
        label={`Actions for ${name}`}
        disabled={busy ? { reason: SAVING_REASON } : undefined}
      >
        <Dropdown.Menu placement="bottom-end">
          {isDefault ? (
            // A menu of one option has no icon.
            <Dropdown.Option alert onPick={run(onRemove)}>
              Remove store
            </Dropdown.Option>
          ) : (
            <>
              <Dropdown.Option icon={<StarIcon />} onPick={run(onMakeDefault)}>
                Make default
              </Dropdown.Option>
              <Dropdown.Separator />
              <Dropdown.Option
                icon={<TrashIcon />}
                alert
                onPick={run(onRemove)}
              >
                Remove store
              </Dropdown.Option>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}
