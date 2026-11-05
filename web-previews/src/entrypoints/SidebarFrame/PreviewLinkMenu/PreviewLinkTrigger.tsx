import { MenuChevron } from 'datocms-react-ui/Chevron';
import DropdownTriggerButton from 'datocms-react-ui/Dropdown/triggers/DropdownTriggerButton';
import type { DropdownTriggerBaseProps } from 'datocms-react-ui/Dropdown/triggers/types';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import Tooltip from 'datocms-react-ui/Tooltip';
import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import type { PreviewLinkWithFrontend } from '../../../types';
import { displayPath, displayUrl, hostOf } from '../../../utils/urls';
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
 * The tooltip of the text of a preview link: its host and clean path (never
 * the URL with its token), only while the text ends with an ellipsis
 */
export function usePreviewLinkTooltip(
  previewLink: PreviewLinkWithFrontend,
): [RefObject<HTMLSpanElement | null>, string | null] {
  const textRef = useRef<HTMLSpanElement>(null);
  const { width } = useElementLayout(textRef);
  const [isCut, setIsCut] = useState(false);
  const url = displayUrl(previewLink.url);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is measured again when it or its width changes
  useLayoutEffect(() => {
    const element = textRef.current;
    setIsCut(element ? element.scrollWidth > element.clientWidth : false);
  }, [url, width]);

  return [textRef, isCut ? url : null];
}

/**
 * The trigger of the menu of the preview links: the label of the link, then
 * its host and path, on one line that takes the free width of the toolbar
 * and ends with an ellipsis, with the chevron at the right end. A cut text
 * has the host and the path as its tooltip. The link is a value that the
 * click changes, thus it has the look of TextualTrigger (the kit's inline ghost button, which keeps the
 * ink of the text). TextualTrigger itself keeps the width of its label, so
 * its text can't end with an ellipsis in the bar.
 */
export function PreviewLinkTrigger({
  open,
  onTrigger,
  previewLink,
  showFrontendName,
}: Props) {
  const [textRef, tooltip] = usePreviewLinkTooltip(previewLink);

  return (
    <Tooltip long label={!open && tooltip} placement="bottom-start">
      <DropdownTriggerButton
        open={open}
        onTrigger={onTrigger}
        className={`button--ghost-inline ${styles.trigger}`}
      >
        <span ref={textRef} className={styles.text}>
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
