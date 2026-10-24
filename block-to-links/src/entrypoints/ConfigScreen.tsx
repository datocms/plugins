/**
 * ConfigScreen Component
 *
 * Main configuration screen for the Block-to-Links converter plugin.
 * Provides UI for selecting a block model, analyzing its usage, and
 * converting it to an independent model with links.
 *
 * @module entrypoints/ConfigScreen
 */

import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import ApiKey from 'datocms-react-ui/ApiKey';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import CardList from 'datocms-react-ui/CardList';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InfoList from 'datocms-react-ui/InfoList';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import SelectInput from 'datocms-react-ui/SelectInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BlockIcon, CircleExclamationIcon, OpenInNewTabIcon } from '../icons';
import type {
  BlockAnalysis,
  ConversionProgress,
  ConversionResult,
  ModularContentFieldInfo,
} from '../types';
import { analyzeBlock } from '../utils/analyzer';
import { createClient } from '../utils/client';
import { convertBlockToModel } from '../utils/converter';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type BlockModel = {
  id: string;
  name: string;
  api_key: string;
};

type Option = {
  label: string;
  value: string;
};

const FIELD_TYPES: Record<ModularContentFieldInfo['fieldType'], string> = {
  rich_text: 'Modular content',
  structured_text: 'Structured text',
  single_block: 'Single block',
};

// =============================================================================
// Sub-components (extracted to reduce cognitive complexity of ConfigScreen)
// =============================================================================

type BlockPickerProps = {
  loadingBlocks: boolean;
  loadError: string | null;
  blockOptions: Option[];
  selectedBlockId: string;
  handleBlockSelect: (blockId: string) => void;
};

function BlockPicker({
  loadingBlocks,
  loadError,
  blockOptions,
  selectedBlockId,
  handleBlockSelect,
}: BlockPickerProps) {
  if (loadingBlocks) {
    return (
      <BlankSlate placement="inline" small loading title="Loading the blocks" />
    );
  }

  if (loadError !== null) {
    return (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<CircleExclamationIcon />}
        title="The blocks didn't load"
        code={loadError}
        description="Reload the page to try again."
        actions={
          <Button label="Reload" onClick={() => window.location.reload()} />
        }
      />
    );
  }

  if (blockOptions.length === 0) {
    return (
      <BlankSlate
        placement="inline"
        small
        icon={<BlockIcon />}
        title="No blocks yet"
        description="Create a block in the blocks library, then reload this page to convert it."
        actions={
          <Button label="Reload" onClick={() => window.location.reload()} />
        }
      />
    );
  }

  return (
    <FieldWrapper
      label="Block to convert"
      hint="The conversion makes a model from the block, moves every block into a record of that model, and links the records where the blocks were."
    >
      <SelectInput
        value={selectedBlockId || null}
        onChange={(id) => handleBlockSelect(id ?? '')}
        options={blockOptions}
        placeholder="Pick a block"
      />
    </FieldWrapper>
  );
}

type AnalyzedGroupsProps = {
  analysis: BlockAnalysis;
  envPrefix: string;
  fullyReplaceBlock: boolean;
  setFullyReplaceBlock: (v: boolean) => void;
  publishAfterChanges: boolean;
  setPublishAfterChanges: (v: boolean) => void;
  handleReset: () => void;
  handleConvert: () => Promise<void>;
};

function AnalyzedGroups({
  analysis,
  envPrefix,
  fullyReplaceBlock,
  setFullyReplaceBlock,
  publishAfterChanges,
  setPublishAfterChanges,
  handleReset,
  handleConvert,
}: AnalyzedGroupsProps) {
  const noFields = analysis.modularContentFields.length === 0;

  return (
    <>
      <Page.Group title="Analysis">
        <InfoList>
          <InfoList.Row title="Block">
            {analysis.block.name} <ApiKey>{analysis.block.apiKey}</ApiKey>
          </InfoList.Row>
          <InfoList.Row title="Affected records">
            {analysis.totalAffectedRecords}
          </InfoList.Row>
          <InfoList.Row title="Fields">
            {analysis.modularContentFields.length}
          </InfoList.Row>
        </InfoList>
      </Page.Group>

      <Page.Group title="Fields using this block" flush>
        <CardList
          actionsVisibility="always"
          empty={
            <Page.GroupInset>
              <EmptySlot message="No field uses this block" />
            </Page.GroupInset>
          }
        >
          {analysis.modularContentFields.map((field) => (
            <CardList.Item
              key={field.id}
              row={{
                summary: (
                  <EntityRow
                    layout="row"
                    title={field.label}
                    afterTitle={
                      <>
                        {field.parentIsBlock && <Pill>In a block</Pill>}
                        {field.localized && <Pill>Localized</Pill>}
                      </>
                    }
                  >
                    <ApiKey>{`${field.parentModelApiKey}.${field.apiKey}`}</ApiKey>{' '}
                    · {FIELD_TYPES[field.fieldType]}
                  </EntityRow>
                ),
                actions: (
                  <Button
                    tone="ghost"
                    size="micro"
                    iconOnly
                    icon={OpenInNewTabIcon}
                    label={`Open “${field.label}” in the schema`}
                    to={`${envPrefix}/schema/item_types/${field.parentModelId}#f${field.id}`}
                    newTab
                  />
                ),
              }}
            />
          ))}
        </CardList>
      </Page.Group>

      <Page.Group
        title="Options"
        footer={
          <div className={s.footer}>
            <Button tone="ghost" label="Cancel" onClick={handleReset} />
            <Button
              tone={fullyReplaceBlock ? 'alert' : 'primary'}
              label={
                fullyReplaceBlock ? 'Convert and replace' : 'Convert to model'
              }
              onClick={handleConvert}
              disabled={
                noFields
                  ? {
                      reason:
                        'No field uses this block, so there is nothing to convert.',
                    }
                  : undefined
              }
            />
          </div>
        }
      >
        <SwitchList>
          <FieldWrapper hint="Deletes the original block model and its data after the conversion. The new links field takes its place.">
            <SwitchInput
              label="Replace the original block"
              value={fullyReplaceBlock}
              onChange={(v) => setFullyReplaceBlock(v === true)}
            />
          </FieldWrapper>
          <FieldWrapper hint="Publishes every record that the conversion creates or updates.">
            <SwitchInput
              label="Publish the records after the conversion"
              value={publishAfterChanges}
              onChange={(v) => setPublishAfterChanges(v === true)}
            />
          </FieldWrapper>
        </SwitchList>
      </Page.Group>
    </>
  );
}

type ConvertingGroupProps = {
  progress: ConversionProgress;
};

function ConvertingGroup({ progress }: ConvertingGroupProps) {
  return (
    <Page.Group
      title="Conversion"
      status={
        <Pill>{`Step ${progress.currentStep} of ${progress.totalSteps}`}</Pill>
      }
    >
      <div className={s.readout}>
        <ProgressBar
          value={progress.percentage / 100}
          ariaLabel={progress.stepDescription}
        />
        <p className={s.line}>
          <span>{progress.stepDescription}</span>
          <span className={s.meta}>{Math.round(progress.percentage)}%</span>
        </p>
        {progress.details && <p className={s.meta}>{progress.details}</p>}
      </div>
    </Page.Group>
  );
}

// =============================================================================
// Helper functions (outside component to avoid recreating on render)
// =============================================================================

/**
 * Opens a confirmation dialog for the conversion operation.
 */
async function openConversionConfirmDialog(
  ctx: Props['ctx'],
  fullyReplaceBlock: boolean,
): Promise<unknown> {
  const confirmTitle = fullyReplaceBlock
    ? 'Convert and replace the block?'
    : 'Convert the block to a model?';
  const confirmContent = fullyReplaceBlock
    ? "This creates a model from the block, moves every block into a record, replaces the block fields with links fields, and deletes the original block model and its data. You can't undo this."
    : 'This creates a model from the block, moves every block into a record, and adds a links field next to each block field. The original block model stays, and you can delete it later.';
  const confirmLabel = fullyReplaceBlock ? 'Convert and replace' : 'Convert';
  const confirmIntent = fullyReplaceBlock ? 'negative' : 'positive';

  return ctx.openConfirm({
    title: confirmTitle,
    content: confirmContent,
    choices: [{ label: confirmLabel, value: 'convert', intent: confirmIntent }],
    cancel: { label: 'Cancel', value: false },
  });
}

/**
 * Builds the success notification message based on conversion mode.
 */
function buildSuccessMessage(
  newModelApiKey: string,
  fullyReplaceBlock: boolean,
): string {
  if (fullyReplaceBlock) {
    return `The block was converted and replaced by the model “${newModelApiKey}”.`;
  }
  return `The block was converted to the model “${newModelApiKey}”. The original block was kept.`;
}

/**
 * Applies the conversion result to the component state and shows a notification.
 */
async function applyConversionResult(
  result: ConversionResult,
  fullyReplaceBlock: boolean,
  setConversionState: (state: ConversionState) => void,
  ctx: Props['ctx'],
): Promise<void> {
  if (result.success) {
    setConversionState({
      status: 'success',
      result: {
        newModelId: result.newModelId || '',
        newModelApiKey: result.newModelApiKey || '',
        migratedRecords: result.migratedRecordsCount,
        convertedFields: result.convertedFieldsCount,
        originalBlockName: result.originalBlockName,
        originalBlockApiKey: result.originalBlockApiKey,
      },
    });
    const successMessage = buildSuccessMessage(
      result.newModelApiKey || '',
      fullyReplaceBlock,
    );
    await ctx.notice(successMessage);
  } else {
    setConversionState({
      status: 'error',
      message: result.error || 'Unknown error occurred',
    });
    await ctx.alert(`The conversion failed: ${result.error}`);
  }
}

/** Discriminated union for tracking conversion state */
type ConversionState =
  | { status: 'idle' }
  | {
      status: 'analyzing';
      progressMessage?: string;
      progressPercentage?: number;
    }
  | { status: 'analyzed'; analysis: BlockAnalysis }
  | { status: 'converting'; progress: ConversionProgress }
  | {
      status: 'success';
      result: {
        newModelId: string;
        newModelApiKey: string;
        migratedRecords: number;
        convertedFields: number;
        originalBlockName?: string;
        originalBlockApiKey?: string;
      };
    }
  | { status: 'error'; message: string };

export default function ConfigScreen({ ctx }: Props) {
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [conversionState, setConversionState] = useState<ConversionState>({
    status: 'idle',
  });
  const [blockModels, setBlockModels] = useState<BlockModel[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Replacement mode - if true, fully replaces original block; if false, adds link field alongside
  const [fullyReplaceBlock, setFullyReplaceBlock] = useState(false);

  // Publish mode - if true, publishes records after creating/updating them
  const [publishAfterChanges, setPublishAfterChanges] = useState(false);

  // Create CMA client
  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) return null;
    return createClient(
      ctx.currentUserAccessToken,
      ctx.environment,
      ctx.cmaBaseUrl,
    );
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  // Fetch all block models using CMA client
  useEffect(() => {
    async function fetchBlockModels() {
      if (!client) {
        setLoadingBlocks(false);
        return;
      }

      try {
        setLoadingBlocks(true);
        // Fetch all item types and filter for modular blocks
        const allItemTypes = await client.itemTypes.list();
        const modularBlocks = allItemTypes.filter(
          (itemType) => itemType.modular_block,
        );

        const blocks: BlockModel[] = modularBlocks
          .map((itemType) => ({
            id: itemType.id,
            name: itemType.name,
            api_key: itemType.api_key,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setBlockModels(blocks);
      } catch (error) {
        console.error('Failed to fetch block models:', error);
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setLoadingBlocks(false);
      }
    }

    fetchBlockModels();
  }, [client]);

  // Handle block selection
  const handleBlockSelect = useCallback(
    async (blockId: string) => {
      setSelectedBlockId(blockId);
      setConversionState({ status: 'idle' });

      if (!blockId || !client) return;

      setConversionState({
        status: 'analyzing',
        progressMessage: 'Initializing analysis...',
        progressPercentage: 0,
      });

      try {
        const analysis = await analyzeBlock(
          client,
          blockId,
          (message, percentage) => {
            setConversionState({
              status: 'analyzing',
              progressMessage: message,
              progressPercentage: percentage,
            });
          },
        );
        setConversionState({ status: 'analyzed', analysis });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setConversionState({ status: 'error', message });
      }
    },
    [client],
  );

  // Handle conversion
  const handleConvert = useCallback(async () => {
    if (!client || !selectedBlockId) return;

    const confirmed = await openConversionConfirmDialog(ctx, fullyReplaceBlock);
    if (confirmed !== 'convert') return;

    const totalSteps = fullyReplaceBlock ? 7 : 6;
    setConversionState({
      status: 'converting',
      progress: {
        currentStep: 0,
        totalSteps,
        stepDescription: 'Starting conversion...',
        percentage: 0,
      },
    });

    try {
      const result = await convertBlockToModel(
        client,
        selectedBlockId,
        (progress) => {
          setConversionState({ status: 'converting', progress });
        },
        fullyReplaceBlock,
        publishAfterChanges,
      );

      await applyConversionResult(
        result,
        fullyReplaceBlock,
        setConversionState,
        ctx,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConversionState({ status: 'error', message });
      await ctx.alert(`The conversion failed: ${message}`);
    }
  }, [client, selectedBlockId, ctx, fullyReplaceBlock, publishAfterChanges]);

  // Reset state
  const handleReset = useCallback(() => {
    setSelectedBlockId('');
    setConversionState({ status: 'idle' });
    setFullyReplaceBlock(false);
    setPublishAfterChanges(false);
  }, []);

  const blockOptions: Option[] = useMemo(() => {
    return blockModels.map((block) => ({
      label: `${block.name} (${block.api_key})`,
      value: block.id,
    }));
  }, [blockModels]);

  // Check for access token
  if (!ctx.currentUserAccessToken) {
    return (
      <Page>
        <Page.Content>
          <Page.Group
            title="Permissions"
            tone="warning"
            status={<Pill tone="warning">Missing</Pill>}
          >
            <Callout tone="warning">
              Grant the plugin the “Current user access token” permission in its
              settings, so it can read and change the schema.
            </Callout>
          </Page.Group>
        </Page.Content>
      </Page>
    );
  }

  const envPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;

  return (
    <Page>
      <Page.Content>
        <Page.Group title="Block">
          <BlockPicker
            loadingBlocks={loadingBlocks}
            loadError={loadError}
            blockOptions={blockOptions}
            selectedBlockId={selectedBlockId}
            handleBlockSelect={handleBlockSelect}
          />
        </Page.Group>

        {conversionState.status === 'analyzing' && (
          <Page.Group title="Analysis">
            <div className={s.readout}>
              <ProgressBar
                value={(conversionState.progressPercentage ?? 0) / 100}
                ariaLabel="Analysis of the block"
              />
              <p className={s.line}>
                <span>
                  {conversionState.progressMessage ||
                    'Analyzing block structure...'}
                </span>
                {conversionState.progressPercentage !== undefined && (
                  <span className={s.meta}>
                    {conversionState.progressPercentage}%
                  </span>
                )}
              </p>
            </div>
          </Page.Group>
        )}

        {conversionState.status === 'analyzed' && (
          <AnalyzedGroups
            analysis={conversionState.analysis}
            envPrefix={envPrefix}
            fullyReplaceBlock={fullyReplaceBlock}
            setFullyReplaceBlock={setFullyReplaceBlock}
            publishAfterChanges={publishAfterChanges}
            setPublishAfterChanges={setPublishAfterChanges}
            handleReset={handleReset}
            handleConvert={handleConvert}
          />
        )}

        {conversionState.status === 'converting' && (
          <ConvertingGroup progress={conversionState.progress} />
        )}

        {conversionState.status === 'success' && (
          <Page.Group
            title="Conversion"
            status={<Pill tone="success">Done</Pill>}
            footer={
              <Button
                tone="primary"
                label="Convert another block"
                onClick={handleReset}
              />
            }
          >
            <InfoList>
              <InfoList.Row title="New model">
                <ApiKey>{conversionState.result.newModelApiKey}</ApiKey>
              </InfoList.Row>
              <InfoList.Row title="Records migrated">
                {conversionState.result.migratedRecords}
              </InfoList.Row>
              <InfoList.Row title="Fields converted">
                {conversionState.result.convertedFields}
              </InfoList.Row>
            </InfoList>
          </Page.Group>
        )}

        {conversionState.status === 'error' && (
          <Page.Group title="Conversion">
            <BlankSlate
              placement="inline"
              small
              error
              icon={<CircleExclamationIcon />}
              title="Something went wrong"
              code={conversionState.message}
              description="Pick the block again to start over."
              actions={<Button label="Try again" onClick={handleReset} />}
            />
          </Page.Group>
        )}
      </Page.Content>
    </Page>
  );
}
