import { RenderItemFormSidebarPanelCtx } from "datocms-plugin-sdk";
import { Canvas, Button, Spinner } from "datocms-react-ui";
import { useCallback, useEffect, useState } from "react";
import { Frontend, Parameters, PreviewLinks, Response } from "../../types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy } from "@fortawesome/free-solid-svg-icons";
import styles from "./styles.module.css";

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const PreviewUrl = ({ ctx }: PropTypes) => {
  const [previewLinks, setPreviewLinks] = useState<PreviewLinks[] | null>(null);
  const [pageError, setPageError] = useState<Error | null>(null);

  const { frontends } = ctx.plugin.attributes.parameters as Parameters;

  const { item, locale, itemType, environment: sandboxEnvironmentId } = ctx;

  const run = useCallback(
    async ({ previewWebhook, name }: Frontend) => {
      setPageError(null);
      setPreviewLinks(null);

      if (!previewWebhook) {
        throw new Error(`Missing "Preview Webhook URL" option!`);
      }

      const url = new URL(previewWebhook);

      const body = JSON.stringify({
        item,
        itemType,
        sandboxEnvironmentId,
        locale,
        name,
      });

      const request = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, Accept",
          "Content-Type": "application/json",
        },
        body,
      });

      if (request.status !== 200) {
        throw new Error(`Endpoint returned status ${request.status}`);
      }

      try {
        const response: Response = await request.json();

        if (!response.urls) {
          throw new Error(`Please provide a valid payload`);
        }

        setPreviewLinks(response.urls);
      } catch (e) {
        setPageError(e as Error);
        setPreviewLinks(null);
        console.error(`Web Previews link plugin error!`, e);
      }
    },
    [sandboxEnvironmentId, item, itemType, locale]
  );

  useEffect(() => {
    frontends.forEach((frontend) => run(frontend));
  }, [run, frontends]);

  return (
    <Canvas ctx={ctx}>
      {previewLinks &&
        previewLinks.map(({ url, label }) => {
          return (
            <div className={styles.grid}>
              <a
                href={url}
                className={styles.link}
                target="_blank"
                rel="noreferrer"
              >
                <span>{label}</span>
              </a>
              <Button
                onClick={() => navigator.clipboard.writeText(url)}
                buttonSize="xxs"
              >
                <FontAwesomeIcon icon={faCopy} />
              </Button>
            </div>
          );
        })}
      {!previewLinks && <Spinner />}
      {previewLinks && previewLinks.length === 0 && (
        <div>No web previews to display</div>
      )}
      {pageError && (
        <p className="Plugin__bar__status-error">
          Error fetching data! More info on console
        </p>
      )}
    </Canvas>
  );
};

export default PreviewUrl;
