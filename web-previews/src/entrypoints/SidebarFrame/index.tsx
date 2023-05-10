import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { faCopy } from '@fortawesome/free-solid-svg-icons';
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
import { Frontend, PreviewLink } from '../../types';
import { FrontendStatus, useStatusByFrontend } from '../../utils/common';
import styles from './styles.module.css';

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
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const [previewLink, setPreviewLink] = useState<PreviewLink | undefined>();
  const [iframeLoading, setIframeLoading] = useState(false);

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
    if (!previewLink) {
      setIframeLoading(false);
      return;
    }

    setIframeLoading(true);
  }, [previewLink?.url]);

  return (
    <Canvas ctx={ctx} noAutoResizer={true}>
      <div className={styles.wrapper}>
        {statusByFrontend ? (
          <>
            <div className={styles.toolbar}>
              <div className={styles.toolbarMain}>
                <Dropdown
                  renderTrigger={({ open, onClick }) => (
                    <button onClick={onClick} className={styles.toolbarTitle}>
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
              )}
            </div>
            {previewLink && (
              <div className={styles.frame}>
                <iframe
                  key={previewLink.url}
                  title={previewLink.url}
                  src={previewLink.url}
                  onLoad={() => setIframeLoading(false)}
                />
                {iframeLoading && <Spinner placement="centered" size={48} />}
              </div>
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
