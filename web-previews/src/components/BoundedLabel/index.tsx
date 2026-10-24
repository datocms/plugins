import styles from './styles.module.css';

type Props = {
  /** A name from the plugin settings */
  children: string;
};

/**
 * The label of a menu trigger that shows a name from the plugin settings (a
 * viewport preset, a frontend). The kit's ButtonTrigger keeps the width of
 * its label, so a long name would take the width of the main control of the
 * bar (the menu of the links, the address of the page). This label stops at
 * a short width with an ellipsis. The whole name stays in the button, as
 * its accessible name, and the menu shows it as the active option.
 *
 * The cut name gets no tooltip: a tooltip that comes and goes with the
 * length of the name would mount the trigger again after a pick, and the
 * focus that the menu gives back to the trigger would be lost.
 */
export function BoundedLabel({ children }: Props) {
  return <span className={styles.label}>{children}</span>;
}
