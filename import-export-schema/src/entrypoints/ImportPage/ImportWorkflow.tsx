import classNames from 'classnames';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { dropTargetClassName } from 'datocms-react-ui/dnd';
import Main from 'datocms-react-ui/Main';
import {
  CircleExclamationIcon,
  FolderOpenIcon,
  ImportIcon,
  RefreshIcon,
} from '@/icons';
import type { LongTaskProgress } from '@/shared/tasks/useLongTask';
import {
  describeSchemaReadError,
  errorCode,
  isPermissionError,
} from '@/utils/apiError';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import type { Conflicts } from './ConflictsManager/buildConflicts';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';
import { Inner } from './Inner';
import ResolutionsForm, { type Resolutions } from './ResolutionsForm';
import s from './styles.module.css';
import { useJsonFileInput } from './useJsonFileInput';

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
  /** The page takes no file, for example while the import runs */
  dropDisabled?: boolean;
  /** The progress of the comparison of the file with the project */
  preparingProgress?: LongTaskProgress;
  /**
   * Asks to drop the file and its choices, to choose another file. It asks
   * first only when the user made choices.
   */
  onRequestClose?: (hasChoices: boolean) => void;
};

/**
 * The import page, from the choice of the file to the review of the
 * conflicts. The whole page takes a dropped file at every step: a file
 * dropped during the review replaces the current one.
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
  dropDisabled = false,
  preparingProgress,
  onRequestClose,
}: Props) {
  const { ref, isOver, open, input } = useJsonFileInput({
    ctx,
    onJsonDrop: onDrop,
    disabled: dropDisabled,
  });

  function renderStep() {
    if (!exportSchema) {
      return loadingRecipe ? (
        <Main>
          <BlankSlate
            placement="area"
            titleLevel={1}
            loading
            title="Loading the shared export"
          />
        </Main>
      ) : (
        <OverviewStep onChooseFile={open} />
      );
    }

    if (conflictsError) {
      return (
        <ComparisonFailedStep
          error={conflictsError}
          onRetry={onRetryConflicts}
          onChooseAnotherFile={open}
        />
      );
    }

    if (!conflicts) {
      return <ComparingStep progress={preparingProgress} />;
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
            label={exportSchema[0]}
            onRequestClose={onRequestClose}
          />
        </ResolutionsForm>
      </ConflictsContext.Provider>
    );
  }

  return (
    <div
      ref={ref}
      className={classNames(
        s.layout,
        dropTargetClassName({ isOver, ringOnly: true }),
      )}
    >
      {input}
      {renderStep()}
      {isOver ? (
        <div className="DropTarget__label">
          <span>
            {exportSchema
              ? `Drop to replace “${exportSchema[0]}”`
              : 'Drop to open the file'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** No file yet: the overview of the page, with the file picker */
function OverviewStep({ onChooseFile }: { onChooseFile: () => void }) {
  return (
    <Main>
      <BlankSlate
        placement="area"
        titleLevel={1}
        icon={<ImportIcon />}
        title="Import schema"
        description="Drop a JSON file exported with this plugin anywhere on this page, or choose it from your computer."
        actions={
          <Button
            tone="primary"
            icon={FolderOpenIcon}
            label="Choose a file"
            onClick={onChooseFile}
          />
        }
      />
    </Main>
  );
}

/**
 * The file is compared with the project. One busy signal: the spinner, with
 * the current step as its caption.
 */
function ComparingStep({ progress }: { progress?: LongTaskProgress }) {
  return (
    <Main>
      <BlankSlate
        placement="area"
        titleLevel={1}
        loading
        title="Comparing the file with the project"
        caption={progress?.label}
      />
    </Main>
  );
}

/** The comparison failed: its message, a new attempt, or another file */
function ComparisonFailedStep({
  error,
  onRetry,
  onChooseAnotherFile,
}: {
  error: Error;
  onRetry: () => void;
  onChooseAnotherFile: () => void;
}) {
  return (
    <Main>
      <BlankSlate
        placement="area"
        titleLevel={1}
        error
        icon={<CircleExclamationIcon />}
        title="The file could not be compared with the project"
        code={errorCode(error)}
        description={describeSchemaReadError(error)}
        actions={
          // Neither another attempt nor another file gives a permission
          isPermissionError(error) ? undefined : (
            <>
              <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
              <Button
                label="Choose another file"
                onClick={onChooseAnotherFile}
              />
            </>
          )
        }
      />
    </Main>
  );
}
