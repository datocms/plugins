import {
  faCaretDown,
  faCaretUp,
  faEye,
  faEyeSlash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  Dropdown,
  DropdownGroup,
  DropdownMenu,
  DropdownOption,
  Spinner,
} from 'datocms-react-ui';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useDeepCompareEffect } from 'use-deep-compare';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLink,
} from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
import styles from './styles.module.css';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import { type Viewport, DEFAULT_VIEWPORTS } from '../../types/viewport';
import { ViewportSelector } from '../../components/ViewportSelector';
import { ViewportCustomizer } from '../../components/ViewportCustomizer';
import { useIframeScaling } from '../../hooks/useIframeScaling';
import { computeIframeStyles } from '../../utils/iframeStyles';

function Iframe({
  previewLink,
  allow,
  viewport,
}: {
  previewLink: PreviewLink;
  allow?: string;
  viewport: Viewport;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const { scale } = useIframeScaling(viewport, containerRef);
  const iframeStyle = computeIframeStyles(viewport, scale);

  return (
    <div ref={containerRef} className={`${styles.frame} ${viewport.isFitToSidebar ? styles.frameFitToSidebar : ''}`}>
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

type PropTypes = {
  ctx: RenderItemFormSidebarCtx;
};

const FrontendGroup = ({
  status,
  frontend,
  hideIfNoLinks,
  onSelectPreviewLink,
  currentPreviewLink,
}: {
  status: FrontendStatus;
  frontend: Frontend;
  hideIfNoLinks?: boolean;
  currentPreviewLink: PreviewLink | undefined;
  onSelectPreviewLink: (previewLink: PreviewLink) => void;
}) => {
  if (
    'previewLinks' in status &&
    status.previewLinks.length === 0 &&
    hideIfNoLinks
  ) {
    return null;
  }

  return (
    <DropdownGroup name={frontend.name}>
      <FrontendPreviewLinks
        status={status}
        onSelectPreviewLink={onSelectPreviewLink}
        currentPreviewLink={currentPreviewLink}
      />
    </DropdownGroup>
  );
};

const FrontendPreviewLinks = ({
  status,
  onSelectPreviewLink,
  currentPreviewLink,
}: {
  status: FrontendStatus;
  onSelectPreviewLink: (previewLink: PreviewLink) => void;
  currentPreviewLink: PreviewLink | undefined;
}) => {
  if ('error' in status) {
    return <div>Webhook error: check the console for more info!</div>;
  }

  return (
    <>
      {status.previewLinks.length === 0 ? (
        <DropdownOption>
          No preview links available for this record.
        </DropdownOption>
      ) : (
        status.previewLinks.map((previewLink) => {
          return (
            <DropdownOption
              key={previewLink.url}
              onClick={() => onSelectPreviewLink(previewLink)}
              active={currentPreviewLink?.url === previewLink.url}
            >
              {previewLink.label}
            </DropdownOption>
          );
        })
      )}
    </>
  );
};

const PreviewFrame = ({ ctx }: PropTypes) => {
  const [reloadCounter, setReloadCounter] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  const [currentViewport, setCurrentViewport] = useState<Viewport>(DEFAULT_VIEWPORTS[0]);

  const handleViewportChange = useCallback((viewport: Viewport) => {
    setCurrentViewport(viewport);
  }, []);

  const handleDimensionChange = useCallback((dimension: number, type: 'width' | 'height') => {
    setCurrentViewport(prev => ({
      ...prev,
      [type]: dimension,
    }));
  }, []);

  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const [currentPreviewLink, setCurrentPreviewLink] = useState<
    PreviewLink | undefined
  >();

  const { iframeAllowAttribute } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  usePersistedSidebarWidth(ctx.site);

  useDeepCompareEffect(() => {
    if (!statusByFrontend) {
      return;
    }

    const previewLinks = Object.entries(statusByFrontend).flatMap((result) => {
      const status = result[1];
      if ('previewLinks' in status) {
        return status.previewLinks;
      }

      return [];
    });

    if (previewLinks.length > 0) {
      setCurrentPreviewLink(previewLinks[0]);
    }
  }, [statusByFrontend]);

  useEffect(() => {
    const reloadSettings = currentPreviewLink?.reloadPreviewOnRecordUpdate;

    if (!reloadSettings) {
      return;
    }

    const delayInMs = reloadSettings === true ? 100 : reloadSettings.delayInMs;

    setTimeout(() => setReloadCounter((old) => old + 1), delayInMs);
  }, [currentPreviewLink]);

  return (
    <Canvas ctx={ctx} noAutoResizer={true}>
      <div className={styles.wrapper}>
        {statusByFrontend ? (
          <>
            <div className={styles.toolbar}>
              <div className={styles.toolbarButtons}>
                <button
                  type="button"
                  className={styles.toolbarTitle}
                  onClick={() => setIsOpen((open) => !open)}
                  title={isOpen ? "Hide preview" : "Show preview"}
                >
                  <FontAwesomeIcon icon={isOpen ? faEye : faEyeSlash} />
                </button>
                <ViewportSelector
                  currentViewport={currentViewport}
                  onViewportChange={handleViewportChange}
                />
              </div>
              <div className={styles.toolbarMain}>
                <Dropdown
                  renderTrigger={({ open, onClick }) => (
                    <button
                      type="button"
                      onClick={onClick}
                      className={styles.toolbarTitle}
                    >
                      <span className={styles.toolbarTitleText}>
                        {currentPreviewLink
                          ? currentPreviewLink.label
                          : 'Please select a preview...'}
                      </span>
                      <FontAwesomeIcon
                        icon={open ? faCaretUp : faCaretDown}
                        className={styles.toolbarTitleIcon}
                      />
                    </button>
                  )}
                >
                  <DropdownMenu>
                    {frontends.length === 0 ? (
                      <div>No frontends configured!</div>
                    ) : frontends.length === 1 ? (
                      <FrontendPreviewLinks
                        status={Object.values(statusByFrontend)[0]}
                        currentPreviewLink={currentPreviewLink}
                        onSelectPreviewLink={setCurrentPreviewLink}
                      />
                    ) : Object.values(statusByFrontend).every(
                        (status) =>
                          'previewLinks' in status &&
                          status.previewLinks.length === 0,
                      ) ? (
                      <DropdownOption>
                        No preview links available for this record.
                      </DropdownOption>
                    ) : (
                      frontends.map((frontend) => (
                        <FrontendGroup
                          key={frontend.name}
                          frontend={frontend}
                          status={statusByFrontend[frontend.name]}
                          hideIfNoLinks
                          currentPreviewLink={currentPreviewLink}
                          onSelectPreviewLink={setCurrentPreviewLink}
                        />
                      ))
                    )}
                  </DropdownMenu>
                </Dropdown>
              </div>
            </div>

            {isOpen && currentPreviewLink && (
              <>
                {currentViewport.isCustom && (
                  <ViewportCustomizer
                    viewport={currentViewport}
                    onDimensionChange={handleDimensionChange}
                  />
                )}
                <Iframe
                  key={`${currentPreviewLink.url}-${reloadCounter}`}
                  previewLink={currentPreviewLink}
                  viewport={currentViewport}
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

export default PreviewFrame;
