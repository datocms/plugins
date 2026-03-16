import {
  faCopy,
  faExternalLinkAlt,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner, useCtx } from 'datocms-react-ui';
import { ButtonGroup, ButtonGroupButton } from '../../components/ButtonGroup';
import type { Frontend } from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
import { extractRedirectFromDraftModePreviewUrl, inspectorUrl } from '../../utils/urls';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FrontendGroup = ({
  status,
  frontend,
  hideIfNoLinks,
}: {
  status: FrontendStatus | undefined;
  frontend: Frontend;
  hideIfNoLinks?: boolean;
}) => {
  if (
    !status ||
    ('previewLinks' in status &&
      status.previewLinks.length === 0 &&
      hideIfNoLinks)
  ) {
    return null;
  }

  return (
    <div className={styles.group}>
      <div className={styles.groupName}>{frontend.name}</div>
      <FrontendResult status={status} frontend={frontend} />
    </div>
  );
};

const FrontendResult = ({
  status,
  frontend,
}: {
  status: FrontendStatus;
  frontend: Frontend;
}) => {
  const ctx = useCtx();

  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl;

  if ('error' in status) {
    return <div>API endpoint error: check the console for more info!</div>;
  }

  return (
    <>
      {status.previewLinks.length === 0 ? (
        <div>No preview links available.</div>
      ) : (
        status.previewLinks.map(({ url: urlString, label }) => {
          const url = new URL(urlString);
          const visualEditingPath = draftModeUrl
            ? extractRedirectFromDraftModePreviewUrl(urlString, draftModeUrl)
            : undefined;

          return (
            <div key={`${url}`} className={styles.previewLink}>
              <div className={styles.previewLink__body}>
                <div className={styles.previewLink__label}>{label}</div>
                <div className={styles.previewLink__pathname} title={urlString}>
                  {visualEditingPath ?? url.pathname + url.search}
                </div>
              </div>
              <ButtonGroup>
                {visualEditingPath && (
                  <ButtonGroupButton
                    tooltip="Open in Visual"
                    onClick={() => {
                      ctx.navigateTo(
                        inspectorUrl(ctx, {
                          path: visualEditingPath,
                          frontend: frontend.name,
                        }),
                      );
                    }}
                  >
                    <FontAwesomeIcon icon={faEye} />
                  </ButtonGroupButton>
                )}
                <ButtonGroupButton
                  tooltip="Copy URL to clipboard"
                  onClick={() => {
                    navigator.clipboard.writeText(urlString);
                    ctx.notice('URL saved in clipboard!');
                  }}
                >
                  <FontAwesomeIcon icon={faCopy} />
                </ButtonGroupButton>
                <ButtonGroupButton
                  as="a"
                  href={urlString}
                  target="_blank"
                  rel="noreferrer"
                  tooltip="Visit URL"
                >
                  <FontAwesomeIcon icon={faExternalLinkAlt} />
                </ButtonGroupButton>
              </ButtonGroup>
            </div>
          );
        })
      )}
    </>
  );
};

const PreviewUrl = ({ ctx }: PropTypes) => {
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const firstStatus = statusByFrontend && Object.values(statusByFrontend)[0];

  return (
    <Canvas ctx={ctx}>
      {statusByFrontend ? (
        <>
          {frontends.length === 0 ? (
            <div>No frontends configured!</div>
          ) : frontends.length === 1 && firstStatus ? (
            <FrontendResult status={firstStatus} frontend={frontends[0]} />
          ) : Object.values(statusByFrontend).every(
              (status) =>
                !status ||
                ('previewLinks' in status && status.previewLinks.length === 0),
            ) ? (
            <div>No preview links available.</div>
          ) : (
            frontends.map((frontend) => (
              <FrontendGroup
                key={frontend.name}
                frontend={frontend}
                status={statusByFrontend[frontend.name]}
                hideIfNoLinks
              />
            ))
          )}
        </>
      ) : (
        <Spinner />
      )}
    </Canvas>
  );
};

export default PreviewUrl;
