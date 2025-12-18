import { buildClient } from '@datocms/cma-client-browser';
import { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useState } from 'react';
import s from './styles.module.css';

type PropTypes = {
  ctx: RenderModalCtx;
};

export default function CustomModal({ ctx }: PropTypes) {
  const [unusedAssets, setUnusedAssets] = useState<Array<any>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const client = buildClient({
    apiToken: ctx.currentUserAccessToken as string,
  });

  useEffect(() => {
    client.uploads
      .list({
        filter: {
          fields: {
            inUse: { eq: false },
          },
        },
      })
      .then((result) => {
        setUnusedAssets(result);
        setIsLoading(false);
      });
  }, []);

  return (
    <Canvas ctx={ctx}>
      {isLoading && (
        <div style={{ height: '200px', position: 'relative' }}>
          <Spinner size={48} placement="centered" />
        </div>
      )}
      {!isLoading &&
        (unusedAssets.length ? (
          <div className={s.cancelationModal}>
            <h4>This will delete all of the folowing assets:</h4>
            <ul className={s.assetList}>
              {unusedAssets.map((asset) => {
                return (
                  <li key={asset.id}>
                    <a href={asset.url} target="_blank">
                      {asset.filename}
                    </a>
                  </li>
                );
              })}
            </ul>
            <h2>Are you sure you want to proceed?</h2>
            <div className={s.buttonContainer}>
              <Button
                onClick={() => {
                  ctx.resolve('');
                }}
                className={s.modalButton}
                buttonType="muted"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setIsLoading(true);
                  client.uploads
                    .bulkDestroy({
                      uploads: unusedAssets.map((asset) => {
                        return { type: 'upload', id: asset.id };
                      }),
                    })
                    .then(() => {
                      ctx.notice('Unused assets successfully deleted!');
                      ctx.resolve('');
                    });
                }}
                className={s.modalButton}
                buttonType="negative"
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <h4>There are no unused assets in your library</h4>
        ))}
    </Canvas>
  );
}
