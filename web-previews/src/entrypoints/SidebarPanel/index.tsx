import { faCopy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner, useCtx } from 'datocms-react-ui';
import { Frontend } from '../../types';
import { FrontendStatus, useStatusByFrontend } from '../../utils/common';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FrontendGroup = ({
  status,
  frontend,
  hideIfNoLinks,
}: {
  status: FrontendStatus;
  frontend: Frontend;
  hideIfNoLinks?: boolean;
}) => {
  if (
    'previewLinks' in status &&
    status.previewLinks.length === 0 &&
    hideIfNoLinks
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

  if ('error' in status) {
    return <div>Webhook error: check the console for more info!</div>;
  }

  return (
    <>
      {status.previewLinks.length === 0 ? (
        <div>No preview links available.</div>
      ) : (
        status.previewLinks.map(({ url, label }, index) => {
          return (
            <div key={`${label}-${index}`} className={styles.grid}>
              <a
                href={url}
                className={styles.link}
                target="_blank"
                rel="noreferrer"
              >
                {label}
              </a>
              <button
                type="button"
                className={styles.copy}
                title="Copy URL to clipboard"
                onClick={() => {
                  navigator.clipboard.writeText(url);
                  ctx.notice('URL saved in clipboard!');
                }}
              >
                <FontAwesomeIcon icon={faCopy} />
              </button>
            </div>
          );
        })
      )}
    </>
  );
};

const PreviewUrl = ({ ctx }: PropTypes) => {
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);

  return (
    <Canvas ctx={ctx}>
      {statusByFrontend ? (
        <>
          {frontends.length === 0 ? (
            <div>No frontends configured!</div>
          ) : frontends.length === 1 ? (
            <FrontendResult status={Object.values(statusByFrontend)[0]} />
          ) : Object.values(statusByFrontend).every(
            (status) =>
              'previewLinks' in status && status.previewLinks.length === 0,
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
