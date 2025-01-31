import { faArrowsRotate, faCopy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeepCompareEffect } from 'use-deep-compare';
import {
  type Parameters,
  type PreviewLink,
  type Viewport,
  normalizeParameters,
} from '../../types';
import { useStatusByFrontend } from '../../utils/common';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import { Iframe } from './Iframe';
import { PreviewLinkSelector } from './PreviewLinkSelector';
import { ViewportCustomizer, type ViewportSize } from './ViewportCustomizer';
import { ViewportSelector } from './ViewportSelector';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarCtx;
};

const SidebarFrame = ({ ctx }: PropTypes) => {
  const { iframeAllowAttribute } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const [reloadCounter, setReloadCounter] = useState(0);
  const forceReload = () => setReloadCounter((old) => old + 1);

  const [customViewportSize, setCustomViewportSize] = useState<ViewportSize>({
    width: 800,
    height: 600,
  });

  const [currentViewport, setCurrentViewport] = useState<
    Viewport | 'responsive' | 'custom'
  >('responsive');

  const handleViewportChange = useCallback(
    (viewport: Viewport | 'responsive' | 'custom') => {
      setCurrentViewport(viewport);
    },
    [],
  );

  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const [currentPreviewLink, setCurrentPreviewLink] = useState<
    PreviewLink | undefined
  >();

  usePersistedSidebarWidth(ctx.site);

  const allPreviewLinks = useMemo(() => {
    if (!statusByFrontend) {
      return [];
    }

    return Object.entries(statusByFrontend).flatMap((result) => {
      const status = result[1];
      if ('previewLinks' in status) {
        return status.previewLinks;
      }

      return [];
    });
  }, [statusByFrontend]);

  useDeepCompareEffect(() => {
    if (allPreviewLinks.length > 0) {
      setCurrentPreviewLink(allPreviewLinks[0]);
    }
  }, [allPreviewLinks]);

  useEffect(() => {
    const reloadSettings = currentPreviewLink?.reloadPreviewOnRecordUpdate;

    if (!reloadSettings) {
      return;
    }

    const delayInMs = reloadSettings === true ? 100 : reloadSettings.delayInMs;

    setTimeout(forceReload, delayInMs);
  }, [
    ctx.item?.meta.current_version,
    currentPreviewLink,
    currentPreviewLink?.reloadPreviewOnRecordUpdate,
  ]);

  return (
    <Canvas ctx={ctx} noAutoResizer={true}>
      <div className={styles.wrapper}>
        {statusByFrontend ? (
          <>
            <div className={styles.toolbar}>
              <ViewportSelector
                currentViewport={currentViewport}
                onChange={handleViewportChange}
              />
              <div className={styles.previewLinksWrapper}>
                <PreviewLinkSelector
                  frontends={frontends}
                  statusByFrontend={statusByFrontend}
                  currentPreviewLink={currentPreviewLink}
                  onChange={setCurrentPreviewLink}
                />
              </div>
              {currentPreviewLink && (
                <>
                  <button
                    type="button"
                    className={styles.toolbarButton}
                    title="Refresh the preview"
                    onClick={() => {
                      forceReload();
                    }}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate} />
                  </button>
                  <button
                    type="button"
                    className={styles.toolbarButton}
                    title="Copy URL to clipboard"
                    onClick={() => {
                      navigator.clipboard.writeText(currentPreviewLink.url);
                      ctx.notice('URL saved in clipboard!');
                    }}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                </>
              )}
            </div>
            {currentPreviewLink && (
              <>
                {currentViewport === 'custom' && (
                  <ViewportCustomizer
                    size={customViewportSize}
                    onChange={setCustomViewportSize}
                  />
                )}
                <Iframe
                  key={`${currentPreviewLink.url}-${reloadCounter}`}
                  previewLink={currentPreviewLink}
                  sizing={
                    currentViewport === 'responsive'
                      ? 'responsive'
                      : currentViewport === 'custom'
                        ? customViewportSize
                        : currentViewport
                  }
                  allow={iframeAllowAttribute}
                />
              </>
            )}
          </>
        ) : (
          <div className={styles.spinnerWrapper}>
            <Spinner placement="centered" size={48} />
          </div>
        )}
      </div>
    </Canvas>
  );
};

export default SidebarFrame;
