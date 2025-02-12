import { ItemTypeManager } from '@/utils/itemTypeManager';
import { buildClient } from '@datocms/cma-client';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import type { ExportDoc } from '../ExportPage/buildExportDoc';
import FileDropZone from './FileDropZone';
import { Inner } from './Inner';
import buildConflicts, { type Conflicts } from './buildConflicts';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
type Props = {
  ctx: RenderPageCtx;
};

export function ImportPage({ ctx }: Props) {
  const [exportDoc, setExportDoc] = useState<[string, ExportDoc] | undefined>();

  async function handleImport(filename: string, doc: ExportDoc) {
    setExportDoc([filename, doc]);
  }

  const schema = useMemo(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken!,
      environment: ctx.environment,
    });
    return new ItemTypeManager(client);
  }, [ctx.currentUserAccessToken, ctx.environment]);

  const [conflicts, setConflicts] = useState<Conflicts | undefined>();

  useEffect(() => {
    async function run() {
      if (!exportDoc) {
        return;
      }
      setConflicts(await buildConflicts(exportDoc[1], schema));
    }

    run();
  }, [exportDoc, schema]);

  const graph = useMemo(() => {
    if (!exportDoc) {
      return undefined;
    }

    return buildGraphFromExportDoc(exportDoc[1]);
  }, [exportDoc]);

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          <div className="page__toolbar">
            {exportDoc ? (
              <>
                <div className="page__toolbar__title">
                  Import "{exportDoc[0]}"
                </div>
                <div className="page__toolbar__actions">
                  <Button
                    leftIcon={<FontAwesomeIcon icon={faXmark} />}
                    buttonSize="s"
                    onClick={() => setExportDoc(undefined)}
                  >
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <div className="page__toolbar__title">
                Import schema from JSON
              </div>
            )}
          </div>
          <div className="page__content">
            <FileDropZone onJsonDrop={handleImport}>
              {graph && conflicts && exportDoc ? (
                <Inner
                  graph={graph}
                  conflicts={conflicts}
                  exportDoc={exportDoc[1]}
                />
              ) : (
                <div className="blank-slate">
                  <div className="blank-slate__content">
                    Please drop an export JSON file
                  </div>
                </div>
              )}
            </FileDropZone>
          </div>
        </div>
      </ReactFlowProvider>
    </Canvas>
  );
}
