import { useRef, useState } from 'react';
import type { PreviewLink } from '../../../types';
import type { SizingStrategy } from '../Iframe';
import { computeIframeStyles } from './iframeStyles';
import styles from './styles.module.css';
import { useIframeScaling } from './useIframeScaling';

export function Iframe({
  previewLink,
  allow,
  sizing,
}: {
  previewLink: PreviewLink;
  allow?: string;
  sizing: SizingStrategy;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const { scale } = useIframeScaling(sizing, containerRef);
  const iframeStyle = computeIframeStyles(sizing, scale);

  return (
    <div
      ref={containerRef}
      className={`${styles.frame} ${sizing === 'responsive' ? styles.frameFitToSidebar : ''}`}
    >
      {iframeLoading && (
        <div className={styles.progressBar}>
          <div className={styles.progressBarValue} />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={previewLink.url}
        title="Content preview"
        allow={allow}
        style={iframeStyle}
        onLoad={() => setIframeLoading(false)}
      />
    </div>
  );
}
