import {
  faArrowsRotate,
  faExternalLinkAlt,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserWrapper } from '../../components/Browser/BrowserWrapper';
import styles from '../../components/Browser/BrowserWrapper/styles.module.css';
import { IframeContainer } from '../../components/Browser/IframeContainer';
import { Toolbar } from '../../components/Browser/Toolbar';
import { ToolbarButton } from '../../components/Browser/Toolbar/ToolbarButton';
import { ToolbarSlot } from '../../components/Browser/Toolbar/ToolbarSlot';
import type { ViewportSize } from '../../components/Browser/ViewportCustomizer';
import { ViewportCustomizer } from '../../components/Browser/ViewportCustomizer';
import { ViewportSelector } from '../../components/Browser/ViewportSelector';
import { ButtonGroup, ButtonGroupButton } from '../../components/ButtonGroup';
import { PreviewSetupGuide } from '../../components/PreviewSetupGuide';
import {
  normalizeParameters,
  type Parameters,
  type PreviewLink,
  type PreviewLinkWithFrontend,
  type Viewport,
} from '../../types';
import { useStatusByFrontend } from '../../utils/common';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import { inspectorUrl } from '../../utils/urls';
import { PreviewLinkSelector } from './PreviewLinkSelector';
import {
  reconcilePreviewLinkSelection,
  sidebarVisualEditingInfo,
} from './previewLinkSelection';
import { useSidebarContentLink } from './useSidebarContentLink';

type PropTypes = {
  ctx: RenderItemFormSidebarCtx;
};

/** Below this sidebar width the toolbar has no room for the viewport selector */
const VIEWPORT_SELECTOR_MIN_WIDTH = 600;

type PreviewLinkSelection = {
  previewLinks: PreviewLinkWithFrontend[];
  selectedPreviewLink: PreviewLinkWithFrontend | undefined;
};

// Pages with real-time updates refresh themselves, so they need no button
function RefreshButton({
  previewLink,
  onClick,
}: {
  previewLink: PreviewLink;
  onClick: () => void;
}) {
  if (previewLink.realtimeUpdates === true) {
    return null;
  }

  return (
    <ToolbarButton
      icon={faArrowsRotate}
      tooltip="Refresh the preview"
      onClick={onClick}
    />
  );
}

const SidebarFrame = ({ ctx }: PropTypes) => {
  const { iframeAllowAttribute, showVisualTab } = normalizeParameters(
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

  usePersistedSidebarWidth(ctx.site);

  const allPreviewLinksWithFrontend = useMemo(() => {
    if (!statusByFrontend) return [];

    return Object.entries(statusByFrontend).flatMap(
      ([frontendName, status]) => {
        if (status && 'previewLinks' in status) {
          return status.previewLinks.map((link) => ({
            ...link,
            frontendName,
          }));
        }
        return [];
      },
    );
  }, [statusByFrontend]);

  const [previewLinkSelection, setPreviewLinkSelection] =
    useState<PreviewLinkSelection>({
      previewLinks: [],
      selectedPreviewLink: undefined,
    });

  let synchronizedPreviewLinkSelection = previewLinkSelection;

  if (previewLinkSelection.previewLinks !== allPreviewLinksWithFrontend) {
    synchronizedPreviewLinkSelection = {
      previewLinks: allPreviewLinksWithFrontend,
      selectedPreviewLink: reconcilePreviewLinkSelection({
        selectedPreviewLink: previewLinkSelection.selectedPreviewLink,
        previewLinks: allPreviewLinksWithFrontend,
      }),
    };

    // Guarded render-time synchronization makes React rerender this component
    // before committing its children. The iframe therefore never sees a
    // stale selection after the Preview Links response changes.
    setPreviewLinkSelection(synchronizedPreviewLinkSelection);
  }

  const currentPreviewLink =
    synchronizedPreviewLinkSelection.selectedPreviewLink;

  const handlePreviewLinkChange = useCallback(
    (selectedPreviewLink: PreviewLinkWithFrontend) => {
      // Remember which response the manual selection came from.
      setPreviewLinkSelection({
        previewLinks: allPreviewLinksWithFrontend,
        selectedPreviewLink,
      });
    },
    [allPreviewLinksWithFrontend],
  );

  const currentFrontend = currentPreviewLink
    ? frontends.find((f) => f.name === currentPreviewLink.frontendName)
    : undefined;

  const currentSidebarVisualEditing = sidebarVisualEditingInfo(
    currentPreviewLink,
    currentFrontend,
  );
  // Draft previews may load the Content Link script; connect only to keep its
  // click-to-edit overlay disabled inside the sidebar.
  const connectContentLink = Boolean(
    currentSidebarVisualEditing?.alreadyInDraftMode,
  );

  const { iframeRef } = useSidebarContentLink(
    ctx,
    connectContentLink ? false : undefined,
  );

  useEffect(() => {
    const reloadSettings = currentPreviewLink?.reloadPreviewOnRecordUpdate;

    if (!reloadSettings) {
      return;
    }

    const delayInMs = reloadSettings === true ? 100 : reloadSettings.delayInMs;

    setTimeout(forceReload, delayInMs);
  }, [
    forceReload,
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
            <ToolbarSlot flex>
              <PreviewLinkSelector
                frontends={frontends}
                statusByFrontend={statusByFrontend}
                currentPreviewLink={currentPreviewLink}
                onChange={handlePreviewLinkChange}
              />
            </ToolbarSlot>
            {currentPreviewLink && (
              <>
                <RefreshButton
                  previewLink={currentPreviewLink}
                  onClick={forceReload}
                />
                <ViewportSelector
                  menuAlignment="right"
                  minWidth={VIEWPORT_SELECTOR_MIN_WIDTH}
                  currentViewport={currentViewport}
                  onChange={handleViewportChange}
                />
                <ToolbarSlot withLeftBorder withPadding={8}>
                  <ButtonGroup>
                    {(() => {
                      if (!currentPreviewLink) return null;

                      if (!showVisualTab || !currentSidebarVisualEditing)
                        return null;

                      return (
                        <ButtonGroupButton
                          tooltip="Edit in Visual Editing"
                          onClick={() => {
                            ctx.navigateTo(
                              inspectorUrl(ctx, {
                                path: currentSidebarVisualEditing.path,
                                frontend: currentPreviewLink.frontendName,
                              }),
                            );
                          }}
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </ButtonGroupButton>
                      );
                    })()}
                    <ButtonGroupButton
                      tooltip="Visit URL"
                      onClick={() => {
                        window.open(currentPreviewLink.url, '_blank');
                      }}
                    >
                      <FontAwesomeIcon icon={faExternalLinkAlt} />
                    </ButtonGroupButton>
                  </ButtonGroup>
                </ToolbarSlot>
              </>
            )}
          </Toolbar>

          {frontends.length === 0 && <PreviewSetupGuide />}

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
                iframeRef={connectContentLink ? iframeRef : undefined}
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
