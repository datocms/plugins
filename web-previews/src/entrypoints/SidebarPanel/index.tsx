import {
  faCopy,
  faExternalLinkAlt,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner, useCtx } from 'datocms-react-ui';
import { ButtonGroup, ButtonGroupButton } from '../../components/ButtonGroup';
import {
  type Frontend,
  type Parameters,
  normalizeParameters,
} from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
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
      <FrontendResult status={status} />
    </div>
  );
};

const FrontendResult = ({ status }: { status: FrontendStatus }) => {
  const ctx = useCtx();

  const { visualEditing } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const visualEditingOrigin = visualEditing?.enableDraftModeUrl
    ? new URL(visualEditing.enableDraftModeUrl).origin
    : undefined;

  if ('error' in status) {
    return <div>Webhook error: check the console for more info!</div>;
  }

  return (
    <>
      {status.previewLinks.length === 0 ? (
        <div>No preview links available.</div>
      ) : (
        status.previewLinks.map(({ url: urlString, label }) => {
          const url = new URL(urlString);

          return (
            <div key={`${url}`} className={styles.previewLink}>
              <div className={styles.previewLink__body}>
                <div className={styles.previewLink__label}>{label}</div>
                <div className={styles.previewLink__pathname} title={urlString}>
                  {url.pathname + url.search}
                </div>
              </div>
              <ButtonGroup>
                {visualEditing?.enableDraftModeUrl &&
                  visualEditingOrigin === url.origin && (
                    <ButtonGroupButton
                      tooltip="Open in Visual"
                      onClick={() => {
                        ctx.navigateTo(
                          `/p/${
                            ctx.plugin.id
                          }/inspectors/visual?${new URLSearchParams({
                            path: url.pathname + url.search,
                          }).toString()}`,
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
            <FrontendResult status={firstStatus} />
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
