import Toolbar from 'datocms-react-ui/Toolbar';
import Tooltip from 'datocms-react-ui/Tooltip';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { EditModeIcon } from '../../../icons';
import styles from './styles.module.css';

const LABEL = 'Edit mode';

type Props = {
  /** The overlays of the page are on */
  pressed: boolean;
  onToggle: () => void;
  /** What edit mode does, shown while the button is enabled */
  tooltip: string;
  /** The tooltip is a paragraph (more than one sentence) */
  long?: boolean;
  /** Why edit mode is not possible now: the button is then disabled */
  disabledReason?: string;
  /**
   * The button shows only its icon, in a narrow bar: its tooltip then names
   * it before telling what it does
   */
  iconOnly?: boolean;
};

/**
 * The kit's button is a new element when it gets or loses a disabled reason
 * (the reason brings a tooltip of its own), so the focus would fall back to
 * the page while a keyboard user is on it. This gives it to the new element,
 * found by its id.
 */
function useFocusKeptAcrossDisabled(id: string, disabled: boolean) {
  // Whether the focus was on the button last. focusin tells where the focus
  // goes; a button that is replaced fires none, so the flag stays.
  const hadFocusRef = useRef(false);
  const wasDisabledRef = useRef(disabled);

  useEffect(() => {
    const isInButton = (target: EventTarget | null) =>
      target instanceof Node &&
      Boolean(document.getElementById(id)?.contains(target));

    const handleFocusIn = (event: FocusEvent) => {
      hadFocusRef.current = isInButton(event.target);
    };
    // A click out of the button that takes the focus nowhere (on the page)
    const handlePointerDown = (event: PointerEvent) => {
      if (!isInButton(event.target)) {
        hadFocusRef.current = false;
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [id]);

  useLayoutEffect(() => {
    if (wasDisabledRef.current === disabled) {
      return;
    }

    wasDisabledRef.current = disabled;

    const focusFellBack =
      document.activeElement === null ||
      document.activeElement === document.body;

    if (hadFocusRef.current && focusFellBack) {
      document.getElementById(id)?.focus();
    }
  }, [id, disabled]);
}

/**
 * The toggle of the click-to-edit overlays, at the right end of the
 * toolbar of a preview.
 */
export function EditModeButton({
  pressed,
  onToggle,
  tooltip,
  long,
  disabledReason,
  iconOnly,
}: Props) {
  const id = useId();
  const descriptionId = useId();
  const disabled = Boolean(disabledReason);
  useFocusKeptAcrossDisabled(id, disabled);

  // The text of the description, from a hidden element (a description reads
  // the text of a hidden element that it points to, and the text isn't read
  // a second time in the flow of the page). A disabled button is described
  // by its reason instead.
  const description = (
    <span id={descriptionId} hidden>
      {tooltip}
    </span>
  );
  // Given only while enabled: an aria-describedby set to undefined would
  // take the place of the one that the tooltip of the reason gives
  const describedBy = disabled ? {} : { 'aria-describedby': descriptionId };

  // An icon-only button has a tooltip of its own, so it isn't in a Tooltip.
  // The label is its accessible name, and the tooltip shows it before what
  // edit mode does; the focused button gets only what edit mode does as its
  // description, so the name isn't read twice.
  if (iconOnly) {
    return (
      <span className={styles.anchor}>
        <Toolbar.Button
          id={id}
          iconOnly
          icon={EditModeIcon}
          label={LABEL}
          tooltip={{ content: `${LABEL}. ${tooltip}`, long }}
          pressed={pressed}
          disabled={disabledReason ? { reason: disabledReason } : undefined}
          {...describedBy}
          onClick={onToggle}
        />
        {description}
      </span>
    );
  }

  // A button with a label shows no tooltip of its own: the Tooltip tells
  // what edit mode does. The Tooltip stays in both states, so the button
  // keeps its place in the tree; a disabled button shows its reason in a
  // tooltip of its own, so this one then has no label and doesn't show.
  // The Tooltip anchors to a span, as for a component without a ref: a ref
  // given to the button would reach the tooltip of the disabled reason,
  // which reads it in a way that React 19 warns about.
  // The span is thus what the Tooltip describes, so the focused button
  // gets the same text as its own description.
  return (
    <Tooltip long={long} label={!disabled && tooltip}>
      <span className={styles.anchor}>
        <Toolbar.Button
          id={id}
          label={LABEL}
          pressed={pressed}
          disabled={disabledReason ? { reason: disabledReason } : undefined}
          {...describedBy}
          onClick={onToggle}
        />
        {description}
      </span>
    </Tooltip>
  );
}
