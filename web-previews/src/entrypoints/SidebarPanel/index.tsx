import { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner, useCtx } from 'datocms-react-ui';
import { useState } from 'react';
import {
  Frontend,
  isValidResponse,
  Parameters,
  PreviewLink,
  Response,
} from '../../types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy } from '@fortawesome/free-solid-svg-icons';
import styles from './styles.module.css';
import {
  useDeepCompareCallback,
  useDeepCompareEffect,
  useDeepCompareMemo,
} from 'use-deep-compare';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

type FrontendStatus = { previewLinks: PreviewLink[] } | { error: any };

async function makeRequest(
  { previewWebhook, name }: Frontend,
  payload: string,
): Promise<[string, FrontendStatus]> {
  try {
    if (!previewWebhook) {
      throw new Error(`Missing "Preview Webhook URL" option!`);
    }

    const url = new URL(previewWebhook);

    const request = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    if (request.status !== 200) {
      throw new Error(
        `[Web Previews] Webhook for frontend "${name}" returned a ${request.status} status!`,
      );
    }

    const response: Response = await request.json();

    if (!isValidResponse(response)) {
      throw new Error(
        `[Web Previews] Webhook for frontend "${name}" returned an invalid payload!`,
      );
    }

    return [name, { previewLinks: response.previewLinks }];
  } catch (error) {
    return [name, { error }];
  }
}

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
        status.previewLinks.map(({ url, label }) => {
          return (
            <div className={styles.grid}>
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
  const [statusByFrontend, setStatusByFrontend] = useState<
    Record<string, FrontendStatus> | undefined
  >();
  const { frontends } = ctx.plugin.attributes.parameters as Parameters;

  const { item, locale, itemType, environment: environmentId } = ctx;

  const payloadBody = useDeepCompareMemo(
    () =>
      JSON.stringify(
        {
          item,
          itemType,
          environmentId,
          locale,
        },
        null,
        2,
      ),
    [environmentId, item, itemType, locale],
  );

  const run = useDeepCompareCallback(
    async (frontends: Frontend[]) => {
      setStatusByFrontend(undefined);

      const results = await Promise.all(
        frontends.map((frontend) => makeRequest(frontend, payloadBody)),
      );

      setStatusByFrontend(Object.fromEntries(results));
    },
    [payloadBody],
  );

  useDeepCompareEffect(() => {
    run(frontends);
  }, [run, frontends]);

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
