import { MenuChevron } from 'datocms-react-ui/Chevron';
import DropdownTriggerButton from 'datocms-react-ui/Dropdown/triggers/DropdownTriggerButton';
import type { DropdownTriggerBaseProps } from 'datocms-react-ui/Dropdown/triggers/types';
import styles from './styles.module.css';

type Props = DropdownTriggerBaseProps & {
  /** The link that the preview shows: its label, then the URL it loads */
  previewLink: { label: string; url: string };
};

/**
 * The trigger of the menu of the preview links: the label of the link, then
 * its URL, on one line that takes the free width of the toolbar and ends
 * with an ellipsis, with the chevron at the right end. The link is a value
 * that the click changes, thus it has the look of TextualTrigger (the kit's
 * inline ghost button, which keeps the ink of the text). TextualTrigger
 * itself keeps the width of its label, so its text can't end with an
 * ellipsis in the bar.
 */
export function PreviewLinkTrigger({ open, onTrigger, previewLink }: Props) {
  return (
    <DropdownTriggerButton
      open={open}
      onTrigger={onTrigger}
      className={`button--ghost-inline ${styles.trigger}`}
    >
      {/* The space keeps the label and the URL apart in the name of the
          button too */}
      <span className={styles.text}>
        <span className={styles.label}>{previewLink.label}</span>{' '}
        <span className={styles.url}>{previewLink.url}</span>
      </span>
      <MenuChevron />
    </DropdownTriggerButton>
  );
}
