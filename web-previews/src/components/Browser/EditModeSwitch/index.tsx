import Label from 'datocms-react-ui/Label';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import Tooltip from 'datocms-react-ui/Tooltip';
import { useId } from 'react';
import styles from './styles.module.css';

const LABEL = 'Edit mode';

type Props = {
  /** The overlays of the page are on */
  pressed: boolean;
  onToggle: () => void;
  /** What edit mode does, shown while the switch is enabled */
  tooltip: string;
  /** The tooltip is a paragraph (more than one sentence) */
  long?: boolean;
  /** Why edit mode is not possible now: the switch is then disabled */
  disabledReason?: string;
  /**
   * The switch shows without its label, in a narrow bar: its tooltip then
   * names it before telling what it does
   */
  iconOnly?: boolean;
};

/**
 * The switch of the click-to-edit overlays, at the right end of the toolbar
 * of a preview. A switch, not a toggle button: on and off read at a glance.
 */
export function EditModeSwitch({
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

  // The Tooltip tells what edit mode does, or why it's off limits now. The
  // switch gets the same text as its description, from a hidden element (a
  // description reads the text of a hidden element that it points to).
  const tooltipText =
    disabledReason ?? (iconOnly ? `${LABEL}. ${tooltip}` : tooltip);

  return (
    <Tooltip long={long && !disabled} label={tooltipText}>
      {/* The Tooltip anchors to a span: the switch takes no ref */}
      <span
        className={
          iconOnly ? `${styles.anchor} ${styles.labelHidden}` : styles.anchor
        }
      >
        <SwitchInput
          id={id}
          name="editMode"
          // In a narrow bar, the label is only for a screen reader
          label={iconOnly ? <Label htmlFor={id} label={LABEL} hidden /> : LABEL}
          value={pressed}
          onChange={onToggle}
          disabled={disabled}
          aria-describedby={descriptionId}
        />
        <span id={descriptionId} hidden>
          {disabledReason ?? tooltip}
        </span>
      </span>
    </Tooltip>
  );
}
