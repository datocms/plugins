import { ItemTypeManager } from '@/utils/itemTypeManager';
import { buildClient } from '@datocms/cma-client';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import type { ExportDoc } from '../ExportPage/buildExportDoc';
import { ConflictsContext } from './ConflictsContext';
import FileDropZone from './FileDropZone';
import { Inner } from './Inner';
import ResolutionsForm from './ResolutionsForm';
import buildConflicts, { type Conflicts } from './buildConflicts';
type Props = {
  ctx: RenderPageCtx;
};

// ExportDoc + Schema -> Conflicts
// Conflicts -> Resolutions
// ExportDoc + Resolutions -> Graph

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
              {conflicts && exportDoc ? (
                <ConflictsContext.Provider value={conflicts}>
                  <ResolutionsForm schema={schema} onSubmit={() => {}}>
                    <Inner exportDoc={exportDoc[1]} />
                  </ResolutionsForm>
                </ConflictsContext.Provider>
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
