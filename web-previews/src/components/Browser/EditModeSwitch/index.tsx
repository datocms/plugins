import Label from 'datocms-react-ui/Label';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import Toolbar from 'datocms-react-ui/Toolbar';
import Tooltip from 'datocms-react-ui/Tooltip';
import { useId } from 'react';
import styles from './styles.module.css';

type Props = {
  /** The overlays of the page are on */
  pressed: boolean;
  /** Holding Alt in the preview flipped the overlays: they go back on release */
  temporary: boolean;
  onToggle: () => void;
  /** Why the overlays can't change now: the switch is then disabled */
  disabledReason?: string;
  /**
   * The switch shows without its label and its hint, in a narrow bar: its
   * tooltip then names it
   */
  iconOnly?: boolean;
};

// Holding Alt changes the label and the hint. Each keeps the width of its
// widest text, which stays hidden under it, so the bar doesn't move
const WIDEST_LABEL = 'Visual editing off';
const WIDEST_HINT = 'Release ⌥ Alt to show';

/**
 * The switch of the click-to-edit overlays, at the right end of the toolbar
 * of a preview, after the hint of the Alt key. A switch, not a toggle
 * button: on and off read at a glance.
 */
export function EditModeSwitch({
  pressed,
  temporary,
  onToggle,
  disabledReason,
  iconOnly,
}: Props) {
  const id = useId();
  const descriptionId = useId();

  const label = `Visual editing ${pressed ? 'on' : 'off'}`;
  // The Alt gesture belongs to the Content Link script of the website, not
  // to an action of the plugin, thus the hint names the key in words
  const hint = temporary
    ? `Release ⌥ Alt to ${pressed ? 'hide' : 'show'}`
    : `Hold ⌥ Alt to ${pressed ? 'hide' : 'peek'}`;

  // The Tooltip tells why the switch is off limits now. In a narrow bar it
  // names the switch only: keys don't go in a tooltip. The switch gets the
  // reason or the hint as its description, from a hidden element (a
  // description reads the text of a hidden element that it points to).
  return (
    <Tooltip label={disabledReason ?? (iconOnly ? label : undefined)}>
      {/* The Tooltip anchors to a span: the switch takes no ref */}
      <span className={styles.root}>
        {!iconOnly && (
          <span className={`${styles.stable} ${styles.hint}`}>
            <Toolbar.Note>{hint}</Toolbar.Note>
            <span className={styles.widest}>
              <Toolbar.Note>{WIDEST_HINT}</Toolbar.Note>
            </span>
          </span>
        )}
        <SwitchInput
          id={id}
          name="editMode"
          // In a narrow bar, the label is only for a screen reader
          label={
            iconOnly ? (
              <Label htmlFor={id} label={label} hidden />
            ) : (
              <Label
                htmlFor={id}
                label={
                  <span className={styles.stable}>
                    <span>{label}</span>
                    <span className={styles.widest}>{WIDEST_LABEL}</span>
                  </span>
                }
              />
            )
          }
          value={pressed}
          onChange={onToggle}
          disabled={Boolean(disabledReason)}
          aria-describedby={descriptionId}
        />
        <span id={descriptionId} hidden>
          {disabledReason ?? hint}
        </span>
      </span>
    </Tooltip>
  );
}
