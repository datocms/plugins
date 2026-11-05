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
  /**
   * Why the overlays can't change now (the page isn't connected): the switch
   * is then disabled, and its state is unknown
   */
  disabledReason?: string;
  /** The hint of the Alt key before the switch: not in a narrow bar */
  showHint: boolean;
};

// Holding Alt changes the label. It keeps the width of its widest text,
// which stays hidden under it, so the bar doesn't move
const WIDEST_LABEL = 'Visual editing off';

const MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/**
 * The switch of the click-to-edit overlays, at the right end of the toolbar
 * of a preview: the hint of the Alt key, the switch, then its label. A
 * switch, not a toggle button: on and off read at a glance. The hint writes
 * the key as text (⌥ on a Mac, Alt on the other systems): `Shortcut` draws a
 * key with its modifiers, not a modifier alone.
 */
export function EditModeSwitch({
  pressed,
  temporary,
  onToggle,
  disabledReason,
  showHint,
}: Props) {
  const id = useId();
  const descriptionId = useId();

  // A page that isn't connected has no state yet: the label says on or off
  // only once the switch works
  const label = disabledReason
    ? 'Visual editing'
    : `Visual editing ${pressed ? 'on' : 'off'}`;
  // The hint tells what holding Alt does to the choice of the editor, thus it
  // doesn't change while Alt is held. The Alt gesture belongs to the Content
  // Link script of the website, not to an action of the plugin
  const chosen = temporary ? !pressed : pressed;
  const verb = chosen ? 'hide' : 'show';

  // The Tooltip tells why the switch is off limits now: the hint of the Alt
  // key, which works only on a connected page, keeps its place but doesn't
  // show. The switch gets the reason or the hint as its description, from a
  // hidden element (a description reads the text of a hidden element that it
  // points to).
  return (
    <Tooltip label={disabledReason}>
      {/* The Tooltip anchors to a span: the switch takes no ref */}
      <span className={styles.root}>
        {showHint && (
          <span className={disabledReason ? styles.idle : undefined}>
            <Toolbar.Note>
              Hold {MAC ? '⌥' : 'Alt'} to {verb}
            </Toolbar.Note>
          </span>
        )}
        <SwitchInput
          id={id}
          name="editMode"
          label={
            <Label
              htmlFor={id}
              label={
                <span className={styles.stable}>
                  <span>{label}</span>
                  <span className={styles.widest}>{WIDEST_LABEL}</span>
                </span>
              }
            />
          }
          value={pressed}
          onChange={onToggle}
          disabled={Boolean(disabledReason)}
          aria-describedby={descriptionId}
        />
        <span id={descriptionId} hidden>
          {disabledReason ?? `Hold ${MAC ? 'Option' : 'Alt'} to ${verb}`}
        </span>
      </span>
    </Tooltip>
  );
}
