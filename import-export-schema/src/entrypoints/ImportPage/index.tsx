import { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import { buildClient } from '@datocms/cma-client';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  Spinner,
  Toolbar,
  ToolbarStack,
  ToolbarTitle,
} from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import { ExportSchema } from '../ExportPage/ExportSchema';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';
import buildConflicts, {
  type Conflicts,
} from './ConflictsManager/buildConflicts';
import FileDropZone from './FileDropZone';
import { Inner } from './Inner';
import ResolutionsForm, { type Resolutions } from './ResolutionsForm';
import { buildImportDoc } from './buildImportDoc';
import importSchema, { type ImportProgress } from './importSchema';
type Props = {
  ctx: RenderPageCtx;
};

export function ImportPage({ ctx }: Props) {
  const [exportSchema, setExportSchema] = useState<
    [string, ExportSchema] | undefined
  >();
  const [importProgress, setImportProgress] = useState<
    ImportProgress | undefined
  >(undefined);

  async function handleDrop(filename: string, doc: ExportDoc) {
    try {
      const schema = new ExportSchema(doc);
      setExportSchema([filename, schema]);
    } catch (e) {
      console.error(e);
      ctx.alert(e instanceof Error ? e.message : 'Invalid export file!');
    }
  }

  const client = useMemo(
    () =>
      buildClient({
        apiToken: ctx.currentUserAccessToken!,
        environment: ctx.environment,
      }),
    [ctx.currentUserAccessToken, ctx.environment],
  );

  const projectSchema = useMemo(() => new ProjectSchema(client), [client]);

  const [conflicts, setConflicts] = useState<Conflicts | undefined>();

  useEffect(() => {
    async function run() {
      if (!exportSchema) {
        return;
      }
      setConflicts(await buildConflicts(exportSchema[1], projectSchema));
    }

    run();
  }, [exportSchema, projectSchema]);

  async function handleImport(resolutions: Resolutions) {
    if (!exportSchema || !conflicts) {
      throw new Error('Invariant');
    }

    try {
      setImportProgress({ finished: 0, total: 1 });

      const importDoc = await buildImportDoc(
        exportSchema[1],
        conflicts,
        resolutions,
      );

      await importSchema(importDoc, client, setImportProgress);

      ctx.notice('Import completed successfully!');
      ctx.navigateTo(
        `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import-export`,
      );

      setImportProgress(undefined);
      setExportSchema(undefined);
    } catch (e) {
      console.error(e);
      ctx.alert('Import could not be completed successfully.');
    }
  }

  return (
    <Canvas ctx={ctx}>
      {importProgress ? (
        <div className="page">
          <Toolbar className="page__toolbar">
            <ToolbarStack stackSize="l">
              <ToolbarTitle>Import in progress</ToolbarTitle>
              <div style={{ flex: '1' }} />
            </ToolbarStack>
          </Toolbar>
          <div className="page__content">
            <div className="progress">
              <div className="progress__meter">
                <div
                  className="progress__meter__track"
                  style={{
                    width: `${(importProgress.finished / importProgress.total) * 100}%`,
                  }}
                />
              </div>
              <div className="progress__content">
                <Spinner size={25} />
                Import in progress: please not close the window or change
                section! 🙏
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ReactFlowProvider>
          <div className="page">
            {exportSchema ? (
              <Toolbar className="page__toolbar">
                <ToolbarStack stackSize="l">
                  <ToolbarTitle>📄 Import "{exportSchema[0]}"</ToolbarTitle>
                  <div style={{ flex: '1' }} />
                  <Button
                    leftIcon={<FontAwesomeIcon icon={faXmark} />}
                    buttonSize="s"
                    onClick={() => setExportSchema(undefined)}
                  >
                    Close
                  </Button>
                </ToolbarStack>
              </Toolbar>
            ) : (
              <Toolbar className="page__toolbar">
                <ToolbarStack stackSize="l">
                  <ToolbarTitle>Schema Import/Export</ToolbarTitle>
                  <div style={{ flex: '1' }} />
                </ToolbarStack>
              </Toolbar>
            )}
            <div className="page__content">
              <FileDropZone onJsonDrop={handleDrop}>
                {exportSchema ? (
                  conflicts ? (
                    <ConflictsContext.Provider value={conflicts}>
                      <ResolutionsForm
                        schema={projectSchema}
                        onSubmit={handleImport}
                      >
                        <Inner exportSchema={exportSchema[1]} />
                      </ResolutionsForm>
                    </ConflictsContext.Provider>
                  ) : (
                    <Spinner placement="centered" size={60} />
                  )
                ) : (
                  <div className="blank-slate">
                    <div className="blank-slate__body">
                      <div className="blank-slate__body__title">
                        Please drop an export JSON file
                      </div>
                      <div className="blank-slate__body__content">
                        To generate an export, navigate to one of your
                        models/blocks and select the "Export as JSON" option.
                      </div>
                    </div>
                  </div>
                )}
              </FileDropZone>
            </div>
          </div>
        </ReactFlowProvider>
      )}
    </Canvas>
  );
}
