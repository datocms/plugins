import classNames from 'classnames';
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import { useMergeRefs } from 'react-merge-refs';
import { computeIframeStyles } from './iframeStyles';
import styles from './styles.module.css';
import { useIframeScaling } from './useIframeScaling';

export type SizingStrategy = { width: number; height: number } | 'responsive';

interface IframeContainerProps {
  src: string;
  title?: string;
  allow?: string;
  loading?: boolean;
  error?: string;
  sizing?: SizingStrategy;
  onLoad?: () => void;
  iframeRef?: React.Ref<HTMLIFrameElement>;
  style?: CSSProperties;
}

export function IframeContainer({
  src,
  title = 'Preview',
  allow,
  loading = false,
  error,
  sizing = 'responsive',
  onLoad,
  iframeRef: externalIframeRef,
  style: customStyle,
}: IframeContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale } = useIframeScaling(sizing, containerRef);
  const iframeStyle = {
    ...computeIframeStyles(sizing, scale),
    ...customStyle,
  };

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMouseEnter = () => {
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement &&
          activeElement.isContentEditable);

      if (!isInputFocused) {
        iframe.focus();
      }
    };

    iframe.addEventListener('mouseenter', handleMouseEnter);

    return () => {
      iframe.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, []);

  const mergedRef = useMergeRefs([iframeRef, externalIframeRef]);

  return (
    <div
      ref={containerRef}
      className={classNames(
        styles.frame,
        sizing === 'responsive' && styles.frameFitToSidebar,
      )}
    >
      {loading && (
        <div className={styles.progressBar}>
          <div className={styles.progressBarValue} />
        </div>
      )}
      {error && (
        <div className={styles.error}>
          <p>{error}</p>
        </div>
      )}
      {!error && (
        <iframe
          ref={mergedRef}
          src={src}
          title={title}
          allow={allow}
          style={iframeStyle}
          onLoad={onLoad}
        />
      )}
    </div>
  );
}
