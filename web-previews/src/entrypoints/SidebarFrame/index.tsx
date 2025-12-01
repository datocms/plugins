import { faArrowsRotate, faCopy } from '@fortawesome/free-solid-svg-icons';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeepCompareEffect } from 'use-deep-compare';
import { BrowserWrapper } from '../../components/Browser/BrowserWrapper';
import styles from '../../components/Browser/BrowserWrapper/styles.module.css';
import { IframeContainer } from '../../components/Browser/IframeContainer';
import { Toolbar } from '../../components/Browser/Toolbar';
import { ToolbarButton } from '../../components/Browser/Toolbar/ToolbarButton';
import { ToolbarSlot } from '../../components/Browser/Toolbar/ToolbarSlot';
import { ViewportCustomizer } from '../../components/Browser/ViewportCustomizer';
import type { ViewportSize } from '../../components/Browser/ViewportCustomizer';
import { ViewportSelector } from '../../components/Browser/ViewportSelector';
import {
  type Parameters,
  type PreviewLink,
  type Viewport,
  normalizeParameters,
} from '../../types';
import { useStatusByFrontend } from '../../utils/common';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import { PreviewLinkSelector } from './PreviewLinkSelector';

type PropTypes = {
  ctx: RenderItemFormSidebarCtx;
};

const SidebarFrame = ({ ctx }: PropTypes) => {
  const { iframeAllowAttribute } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const [reloadCounter, setReloadCounter] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);

  const forceReload = useCallback(() => {
    setReloadCounter((old) => old + 1);
    setIframeLoading(true);
  }, []);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    const reloadSettings = currentPreviewLink?.reloadPreviewOnRecordUpdate;

    if (!reloadSettings) {
      return;
    }

    const delayInMs = reloadSettings === true ? 100 : reloadSettings.delayInMs;

    setTimeout(forceReload, delayInMs);
  }, [
    forceReload,
    ctx.item?.meta.current_version,
    currentPreviewLink,
    currentPreviewLink?.reloadPreviewOnRecordUpdate,
  ]);

  return (
    <Canvas ctx={ctx} noAutoResizer={true}>
      {!statusByFrontend ? (
        <div className={styles.spinnerWrapper}>
          <Spinner placement="centered" size={48} />
        </div>
      ) : (
        <BrowserWrapper>
          <Toolbar>
            <ViewportSelector
              menuAlignment="left"
              currentViewport={currentViewport}
              onChange={handleViewportChange}
            />
            <ToolbarSlot flex withLeftBorder>
              <PreviewLinkSelector
                frontends={frontends}
                statusByFrontend={statusByFrontend}
                currentPreviewLink={currentPreviewLink}
                onChange={setCurrentPreviewLink}
              />
            </ToolbarSlot>
            {currentPreviewLink && (
              <>
                <ToolbarButton
                  icon={faArrowsRotate}
                  title="Refresh the preview"
                  onClick={forceReload}
                />
                <ToolbarButton
                  icon={faCopy}
                  title="Copy URL to clipboard"
                  onClick={() => {
                    navigator.clipboard.writeText(currentPreviewLink.url);
                    ctx.notice('URL saved in clipboard!');
                  }}
                />
              </>
            )}
          </Toolbar>

          {currentPreviewLink && (
            <>
              {currentViewport === 'custom' && (
                <ViewportCustomizer
                  size={customViewportSize}
                  onChange={setCustomViewportSize}
                />
              )}

              <IframeContainer
                key={`${currentPreviewLink.url}-${reloadCounter}`}
                src={currentPreviewLink.url}
                allow={iframeAllowAttribute}
                sizing={
                  currentViewport === 'responsive'
                    ? 'responsive'
                    : currentViewport === 'custom'
                      ? customViewportSize
                      : currentViewport
                }
                loading={iframeLoading}
                onLoad={() => setIframeLoading(false)}
              />
            </>
          )}
        </BrowserWrapper>
      )}
    </Canvas>
  );
};

export default SidebarFrame;
