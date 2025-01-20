import {
  faArrowsRotate,
  faCaretDown,
  faCaretUp,
} from '@fortawesome/free-solid-svg-icons';
import { faCopy } from '@fortawesome/free-solid-svg-icons';
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
import { useEffect, useState } from 'react';
import { useDeepCompareEffect } from 'use-deep-compare';
import {
  type Frontend,
  type Parameters,
  type PreviewLink,
  normalizeParameters,
} from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
import { usePersistedSidebarWidth } from '../../utils/persistedWidth';
import styles from './styles.module.css';

function Iframe({
  previewLink,
  allow,
}: { previewLink: PreviewLink; allow?: string }) {
  const [iframeLoading, setIframeLoading] = useState(true);

  return (
    <div className={styles.frame}>
      {iframeLoading && (
        <div className={styles.progressBar}>
          <div className={styles.progressBarValue} />
        </div>
      )}
      <iframe
        allow={allow}
        title={previewLink.url}
        src={previewLink.url}
        onLoad={() => {
          setIframeLoading(false);
        }}
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

  const forceReload = () => setReloadCounter((old) => old + 1);

  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const [previewLink, setPreviewLink] = useState<PreviewLink | undefined>();
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
      setPreviewLink(previewLinks[0]);
    }
  }, [statusByFrontend]);

  useEffect(() => {
    const reloadSettings = previewLink?.reloadPreviewOnRecordUpdate;

    if (!reloadSettings) {
      return;
    }

    const delayInMs = reloadSettings === true ? 100 : reloadSettings.delayInMs;

    setTimeout(forceReload, delayInMs);
  }, [
    ctx.item?.meta.current_version,
    previewLink?.reloadPreviewOnRecordUpdate,
  ]);

  return (
    <Canvas ctx={ctx} noAutoResizer={true}>
      <div className={styles.wrapper}>
        {statusByFrontend ? (
          <>
            <div className={styles.toolbar}>
              <div className={styles.toolbarMain}>
                <Dropdown
                  renderTrigger={({ open, onClick }) => (
                    <button
                      type="button"
                      onClick={onClick}
                      className={styles.toolbarTitle}
                    >
                      {previewLink
                        ? previewLink.label
                        : 'Please select a preview...'}{' '}
                      {open ? (
                        <FontAwesomeIcon icon={faCaretUp} />
                      ) : (
                        <FontAwesomeIcon icon={faCaretDown} />
                      )}
                    </button>
                  )}
                >
                  <DropdownMenu>
                    {frontends.length === 0 ? (
                      <div>No frontends configured!</div>
                    ) : frontends.length === 1 ? (
                      <FrontendPreviewLinks
                        status={Object.values(statusByFrontend)[0]}
                        currentPreviewLink={previewLink}
                        onSelectPreviewLink={setPreviewLink}
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
                          currentPreviewLink={previewLink}
                          onSelectPreviewLink={setPreviewLink}
                        />
                      ))
                    )}
                  </DropdownMenu>
                </Dropdown>
              </div>
              {previewLink && (
                <>
                  <button
                    type="button"
                    className={styles.copy}
                    title="Refresh the preview"
                    onClick={() => {
                      forceReload();
                    }}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate} />
                  </button>
                  <button
                    type="button"
                    className={styles.copy}
                    title="Copy URL to clipboard"
                    onClick={() => {
                      navigator.clipboard.writeText(previewLink.url);
                      ctx.notice('URL saved in clipboard!');
                    }}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                </>
              )}
            </div>
            {previewLink && (
              <Iframe
                key={`${previewLink.url}-${reloadCounter}`}
                previewLink={previewLink}
                allow={iframeAllowAttribute}
              />
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
