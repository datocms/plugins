import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Spinner } from 'datocms-react-ui';
import { BlankSlate } from '@/components/BlankSlate';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import type { Conflicts } from './ConflictsManager/buildConflicts';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';
import FileDropZone from './FileDropZone';
import { Inner } from './Inner';
import ResolutionsForm, { type Resolutions } from './ResolutionsForm';

type Props = {
  ctx: RenderPageCtx;
  projectSchema: ProjectSchema;
  exportSchema: [string, ExportSchema] | undefined;
  loadingRecipe: boolean;
  conflicts: Conflicts | undefined;
  conflictsError?: Error;
  onRetryConflicts: () => void;
  onDrop: (filename: string, doc: ExportDoc) => Promise<void>;
  onImport: (resolutions: Resolutions) => Promise<void>;
};

/**
 * Encapsulates the import-side UX, from file drop through conflict resolution.
 */
export function ImportWorkflow({
  ctx,
  projectSchema,
  exportSchema,
  loadingRecipe,
  conflicts,
  conflictsError,
  onRetryConflicts,
  onDrop,
  onImport,
}: Props) {
  return (
    <FileDropZone onJsonDrop={onDrop}>
      {(button) => {
        if (exportSchema) {
          if (conflictsError) {
            return (
              <BlankSlate
                title="Could not prepare the import"
                body={
                  <div role="alert">
                    <p>{conflictsError.message}</p>
                    <Button onClick={onRetryConflicts}>Try again</Button>
                  </div>
                }
              />
            );
          }
          if (!conflicts) {
            return <Spinner placement="centered" size={60} />;
          }

          return (
            <ConflictsContext.Provider value={conflicts}>
              <ResolutionsForm
                schema={projectSchema}
                exportSchema={exportSchema[1]}
                onSubmit={onImport}
              >
                <Inner
                  exportSchema={exportSchema[1]}
                  schema={projectSchema}
                  ctx={ctx}
                />
              </ResolutionsForm>
            </ConflictsContext.Provider>
          );
        }

        if (loadingRecipe) {
          return <Spinner placement="centered" size={60} />;
        }

        return (
          <BlankSlate
            title="Upload your schema export file"
            body={
              <>
                <p>
                  Drag and drop your exported JSON file here, or click the
                  button to select one from your computer.
                </p>
                {button}
              </>
            }
          />
        );
      }}
    </FileDropZone>
  );
}
