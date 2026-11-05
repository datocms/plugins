import BlankSlate from 'datocms-react-ui/BlankSlate';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import { type CSSProperties, type Ref, useRef, useState } from 'react';
import { useMergeRefs } from 'react-merge-refs';
import type { ViewportSize, ViewportSizing } from '../viewport';
import styles from './styles.module.css';

type Props = {
  /** The page that the iframe loads */
  src: string;
  /**
   * A new value loads the page again in a new iframe (the reload button).
   * The box around the iframe stays, thus it keeps its measure.
   */
  reloadKey: string;
  sizing: ViewportSizing;
  /** The allow attribute of the iframe, from the plugin settings */
  allow?: string;
  iframeRef?: Ref<HTMLIFrameElement>;
};

/**
 * The scale that fits a fixed size in the free space. The preview gets
 * smaller to fit, never larger. Before the first measure the box has no
 * size: the iframe keeps its own size.
 */
function fitScale(size: ViewportSize, available: ViewportSize): number {
  if (available.width <= 0 || available.height <= 0) {
    return 1;
  }

  const scale = Math.min(
    1,
    available.width / size.width,
    available.height / size.height,
  );

  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function isEditingText(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/**
 * The pointer over the preview gives it the keyboard focus, thus the page
 * scrolls with the keys, unless the user is typing in a field.
 */
function focusOnHover(iframe: HTMLIFrameElement | null) {
  if (!iframe) {
    return;
  }

  const handleMouseEnter = () => {
    if (!isEditingText(document.activeElement)) {
      iframe.focus();
    }
  };

  iframe.addEventListener('mouseenter', handleMouseEnter);

  return () => {
    iframe.removeEventListener('mouseenter', handleMouseEnter);
  };
}

/**
 * The website in an iframe, filling the content of the pane. A fixed size
 * is centered and scaled down to fit the free space. Until the page loads,
 * the area says so.
 */
export function PreviewFrame({
  src,
  reloadKey,
  sizing,
  allow,
  iframeRef,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  // The box is measured, not the window: the custom size bar and the width
  // of the sidebar change the free space too
  const { width, height } = useElementLayout(stageRef);
  const mergedRef = useMergeRefs([focusOnHover, iframeRef]);

  // Each key is a new iframe: it loads until its load event
  const [loadedKey, setLoadedKey] = useState<string>();
  const loading = loadedKey !== reloadKey;

  const fixedSize = sizing === 'responsive' ? undefined : sizing;
  const iframeStyle: CSSProperties | undefined = fixedSize && {
    width: `${fixedSize.width}px`,
    height: `${fixedSize.height}px`,
    transform: `translate(-50%, -50%) scale(${fitScale(fixedSize, { width, height })})`,
  };

  const frameClassName = [
    styles.frame,
    fixedSize && styles.fixed,
    loading && styles.loading,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={frameClassName}>
      <div ref={stageRef} className={styles.stage}>
        {/* Under the iframe, which has no background while it loads: the
            website covers it as soon as it paints */}
        {loading && (
          <BlankSlate placement="area" small loading title="Loading the page" />
        )}
        <iframe
          key={reloadKey}
          ref={mergedRef}
          className={styles.iframe}
          src={src}
          title="Website preview"
          allow={allow}
          style={iframeStyle}
          onLoad={() => setLoadedKey(reloadKey)}
        />
      </div>
    </div>
  );
}
