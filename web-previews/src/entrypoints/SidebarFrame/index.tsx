import {
  faArrowsRotate,
  faCopy,
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
import { EditModeToggle } from '../../components/Browser/Toolbar/EditModeToggle';
import { ToolbarButton } from '../../components/Browser/Toolbar/ToolbarButton';
import { ToolbarSlot } from '../../components/Browser/Toolbar/ToolbarSlot';
import type { ViewportSize } from '../../components/Browser/ViewportCustomizer';
import { ViewportCustomizer } from '../../components/Browser/ViewportCustomizer';
import { ViewportSelector } from '../../components/Browser/ViewportSelector';
import { ButtonGroup, ButtonGroupButton } from '../../components/ButtonGroup';
import {
  normalizeParameters,
  type Parameters,
  type PreviewLinkWithFrontend,
  type Viewport,
} from '../../types';
import { useStatusByFrontend } from '../../utils/common';
import { usePersistedSidebarVisualEditing } from '../../utils/persistedSidebarVisualEditing';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import { inspectorUrl } from '../../utils/urls';
import { PreviewLinkSelector } from './PreviewLinkSelector';
import {
  hasDraftPreviewLink,
  reconcilePreviewLinkSelection,
  sidebarVisualEditingInfo,
} from './previewLinkSelection';
import { useSidebarContentLink } from './useSidebarContentLink';

type PropTypes = {
  ctx: RenderItemFormSidebarCtx;
};

type PreviewLinkSelection = {
  previewLinks: PreviewLinkWithFrontend[];
  selectedPreviewLink: PreviewLinkWithFrontend | undefined;
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

  usePersistedSidebarWidth(ctx.site);

  const [editModeEnabled, setEditModeEnabled] =
    usePersistedSidebarVisualEditing(ctx.site);

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
        previousPreviewLinks: previewLinkSelection.previewLinks,
        previewLinks: allPreviewLinksWithFrontend,
        frontends,
        editModeEnabled,
      }),
    };

    // Guarded render-time synchronization makes React rerender this component
    // before committing its children. The iframe therefore never sees the
    // stale Published selection after a real Draft link appears.
    setPreviewLinkSelection(synchronizedPreviewLinkSelection);
  }

  const currentPreviewLink =
    synchronizedPreviewLinkSelection.selectedPreviewLink;

  const handlePreviewLinkChange = useCallback(
    (selectedPreviewLink: PreviewLinkWithFrontend) => {
      // Remember which response the manual selection came from. If Published
      // is chosen while Draft already exists, later refreshes must preserve it.
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
  const currentLinkHasDraftAlternative = hasDraftPreviewLink(
    currentPreviewLink,
    allPreviewLinksWithFrontend,
    currentFrontend,
  );
  const currentLinkSupportsVisualEditing = Boolean(
    currentSidebarVisualEditing && !currentLinkHasDraftAlternative,
  );

  const editModeActive = Boolean(
    editModeEnabled && currentLinkSupportsVisualEditing,
  );

  // Keep the API-provided link selected in the menu, but show the URL that the
  // iframe actually loads while a non-draft preview is made editable.
  const effectivePreviewLink =
    currentPreviewLink &&
    editModeActive &&
    currentSidebarVisualEditing &&
    !currentSidebarVisualEditing.alreadyInDraftMode
      ? {
          ...currentPreviewLink,
          label: `Editable preview (from ${currentPreviewLink.label})`,
          url: currentSidebarVisualEditing.iframeUrl,
        }
      : currentPreviewLink;

  const connectContentLink = Boolean(
    currentSidebarVisualEditing &&
      (editModeActive || currentSidebarVisualEditing.alreadyInDraftMode),
  );

  const { iframeRef } = useSidebarContentLink(
    ctx,
    connectContentLink ? editModeActive : undefined,
  );

  const editModeTooltip = currentLinkHasDraftAlternative
    ? 'Switch to the draft version to enter edit mode'
    : currentLinkSupportsVisualEditing
      ? 'Click elements in the preview to open their record editor'
      : "This preview link's frontend doesn't support visual editing";

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
                effectivePreviewLink={effectivePreviewLink}
                onChange={handlePreviewLinkChange}
              />
            </ToolbarSlot>
            {currentPreviewLink && effectivePreviewLink && (
              <>
                <ToolbarButton
                  icon={faArrowsRotate}
                  tooltip="Refresh the preview"
                  onClick={forceReload}
                />
                <ToolbarSlot withLeftBorder withPadding={8}>
                  <ButtonGroup>
                    {(() => {
                      if (!currentPreviewLink) return null;

                      if (!currentSidebarVisualEditing) return null;

                      return (
                        <ButtonGroupButton
                          tooltip="Open in Visual"
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
                      tooltip="Copy URL to clipboard"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          effectivePreviewLink.url,
                        );
                        ctx.notice('URL saved in clipboard!');
                      }}
                    >
                      <FontAwesomeIcon icon={faCopy} />
                    </ButtonGroupButton>
                    <ButtonGroupButton
                      tooltip="Visit URL"
                      onClick={() => {
                        window.open(effectivePreviewLink.url, '_blank');
                      }}
                    >
                      <FontAwesomeIcon icon={faExternalLinkAlt} />
                    </ButtonGroupButton>
                  </ButtonGroup>
                </ToolbarSlot>
                <ToolbarSlot withLeftBorder>
                  <EditModeToggle
                    value={editModeActive}
                    disabled={!currentLinkSupportsVisualEditing}
                    tooltip={editModeTooltip}
                    onChange={setEditModeEnabled}
                  />
                </ToolbarSlot>
              </>
            )}
          </Toolbar>

          {currentPreviewLink && effectivePreviewLink && (
            <>
              {currentViewport === 'custom' && (
                <ViewportCustomizer
                  size={customViewportSize}
                  onChange={setCustomViewportSize}
                />
              )}

              <IframeContainer
                key={`${effectivePreviewLink.url}-${reloadCounter}`}
                src={effectivePreviewLink.url}
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
