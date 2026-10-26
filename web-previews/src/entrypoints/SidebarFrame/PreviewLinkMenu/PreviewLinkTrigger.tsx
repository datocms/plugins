import { MenuChevron } from 'datocms-react-ui/Chevron';
import DropdownTriggerButton from 'datocms-react-ui/Dropdown/triggers/DropdownTriggerButton';
import type { DropdownTriggerBaseProps } from 'datocms-react-ui/Dropdown/triggers/types';
import Tooltip from 'datocms-react-ui/Tooltip';
import type { PreviewLinkWithFrontend } from '../../../types';
import { displayPath, hostOf } from '../../../utils/urls';
import styles from './styles.module.css';

type TextProps = {
  previewLink: PreviewLinkWithFrontend;
  /** Prefix the label with the frontend name (useful with several frontends) */
  showFrontendName: boolean;
};

type Props = DropdownTriggerBaseProps & TextProps;

/**
 * The text of a preview link: the frontend name when there are several, the
 * label, then the host and a clean path (no `token`). A narrow sidebar drops
 * the host.
 */
export function PreviewLinkText({ previewLink, showFrontendName }: TextProps) {
  return (
    <>
      {showFrontendName && `${previewLink.frontendName} · `}
      {/* The space keeps the label and the URL apart in the name of the
          button too */}
      <span className={styles.label}>{previewLink.label}</span>{' '}
      <span className={styles.url}>
        <span className={styles.host}>{hostOf(previewLink.url)}</span>
        {displayPath(previewLink.url)}
      </span>
    </>
  );
}

/**
 * The trigger of the menu of the preview links: the label of the link, then
 * its host and path, on one line that takes the free width of the toolbar
 * and ends with an ellipsis, with the chevron at the right end. The full URL
 * is its tooltip. The link is a value that the click changes, thus it has
 * the look of TextualTrigger (the kit's inline ghost button, which keeps the
 * ink of the text). TextualTrigger itself keeps the width of its label, so
 * its text can't end with an ellipsis in the bar.
 */
export function PreviewLinkTrigger({
  open,
  onTrigger,
  previewLink,
  showFrontendName,
}: Props) {
  return (
    <Tooltip label={!open && previewLink.url} placement="bottom-start">
      <DropdownTriggerButton
        open={open}
        onTrigger={onTrigger}
        className={`button--ghost-inline ${styles.trigger}`}
      >
        <span className={styles.text}>
          <PreviewLinkText
            previewLink={previewLink}
            showFrontendName={showFrontendName}
          />
        </span>
        <MenuChevron />
      </DropdownTriggerButton>
    </Tooltip>
  );
}
