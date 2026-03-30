/**
 * ConfigScreen Component
 * 
 * Main configuration screen for the Block-to-Links converter plugin.
 * Provides UI for selecting a block model, analyzing its usage, and
 * converting it to an independent model with links.
 * 
 * @module entrypoints/ConfigScreen
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  Button,
  Spinner,
  SwitchField,
  Form,
  SelectField,
  Section,
} from 'datocms-react-ui';
import { createClient } from '../utils/client';
import { analyzeBlock } from '../utils/analyzer';
import { convertBlockToModel } from '../utils/converter';
import { Icons } from '../components/Icons';
import type { BlockAnalysis, ConversionProgress } from '../types';
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

/** Discriminated union for tracking conversion state */
type ConversionState =
  | { status: 'idle' }
  | { status: 'analyzing'; progressMessage?: string; progressPercentage?: number }
  | { status: 'analyzed'; analysis: BlockAnalysis }
  | { status: 'converting'; progress: ConversionProgress }
  | { status: 'success'; result: { 
      newModelId: string;
      newModelApiKey: string; 
      migratedRecords: number; 
      convertedFields: number;
      originalBlockName?: string;
      originalBlockApiKey?: string;
    } }
  | { status: 'error'; message: string };

export default function ConfigScreen({ ctx }: Props) {
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [conversionState, setConversionState] = useState<ConversionState>({ status: 'idle' });
  const [blockModels, setBlockModels] = useState<BlockModel[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  
  // Replacement mode - if true, fully replaces original block; if false, adds link field alongside
  const [fullyReplaceBlock, setFullyReplaceBlock] = useState(false);
  
  // Publish mode - if true, publishes records after creating/updating them
  const [publishAfterChanges, setPublishAfterChanges] = useState(false);

  // Create CMA client
  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) return null;
    return createClient(ctx.currentUserAccessToken);
  }, [ctx.currentUserAccessToken]);

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
        const modularBlocks = allItemTypes.filter((itemType) => itemType.modular_block);

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

      setConversionState({ status: 'analyzing', progressMessage: 'Initializing analysis...', progressPercentage: 0 });

      try {
        const analysis = await analyzeBlock(client, blockId, (message, percentage) => {
          setConversionState({ status: 'analyzing', progressMessage: message, progressPercentage: percentage });
        });
        setConversionState({ status: 'analyzed', analysis });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setConversionState({ status: 'error', message });
      }
    },
    [client]
  );

  // Handle conversion
  const handleConvert = useCallback(async () => {
    if (!client || !selectedBlockId) return;

    // Build confirmation dialog based on mode
    let confirmTitle: string;
    let confirmContent: string;
    let confirmLabel: string;
    let confirmIntent: 'positive' | 'negative';

    if (fullyReplaceBlock) {
      confirmTitle = 'Convert & Replace Block?';
      confirmContent = 'This will create a new model from the block, create records from block instances, replace block fields with link fields, and DELETE the original block model and all its data. This operation cannot be undone. Are you sure?';
      confirmLabel = 'Convert & Replace';
      confirmIntent = 'negative';
    } else {
      confirmTitle = 'Convert Block to Model?';
      confirmContent = 'This will create a new model from the block, create records from block instances, and create new link fields alongside existing block fields. The original block model will be kept intact and can be deleted later if desired.';
      confirmLabel = 'Convert';
      confirmIntent = 'positive';
    }

    const confirmed = await ctx.openConfirm({
      title: confirmTitle,
      content: confirmContent,
      choices: [
        {
          label: confirmLabel,
          value: 'convert',
          intent: confirmIntent,
        },
      ],
      cancel: {
        label: 'Cancel',
        value: false,
      },
    });

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
      const result = await convertBlockToModel(client, selectedBlockId, (progress) => {
        setConversionState({ status: 'converting', progress });
      }, fullyReplaceBlock, publishAfterChanges);

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

        let successMessage: string;
        if (fullyReplaceBlock) {
          successMessage = `Successfully converted and replaced block with model "${result.newModelApiKey}"!`;
        } else {
          successMessage = `Successfully converted block to model "${result.newModelApiKey}"! Original block preserved.`;
        }
        
        await ctx.notice(successMessage);
      } else {
        setConversionState({
          status: 'error',
          message: result.error || 'Unknown error occurred',
        });
        await ctx.alert(`Conversion failed: ${result.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConversionState({ status: 'error', message });
      await ctx.alert(`Conversion failed: ${message}`);
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
    return blockModels.map(block => ({
      label: `${block.name} (${block.api_key})`,
      value: block.id
    }));
  }, [blockModels]);

  // Check for access token
  if (!ctx.currentUserAccessToken) {
    return (
      <Canvas ctx={ctx}>
        <div className={s.container}>
          <div className={s.error}>
            <h2>Missing Permission</h2>
            <p>
              This plugin requires the "Current user access token" permission to work.
              Please update the plugin settings to grant this permission.
            </p>
          </div>
        </div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <div className={s.container}>
        <div className={s.header}>
          <h1 className={s.title}>Block to Links Converter</h1>
          <p className={s.description}>
            Convert modular content blocks into independent models with links, preserving all data.
          </p>
        </div>

        {loadingBlocks ? (
          <div className={s.loading}>
            <Spinner size={32} />
            <p>Loading block models...</p>
          </div>
        ) : blockModels.length === 0 ? (
          <div className={s.empty}>
            <p>No block models found in this project.</p>
            <Button onClick={() => window.location.reload()}>Refresh</Button>
          </div>
        ) : (
          <Form>
            <div className={s.card}>
              <Section title="Block Selection">
                <SelectField
                  name="block"
                  id="block"
                  label="Choose a Block Model"
                  hint="Select the modular block model you wish to convert."
                  value={blockOptions.find(o => o.value === selectedBlockId)}
                  onChange={(newValue) => handleBlockSelect(newValue ? (newValue as Option).value : '')}
                  selectInputProps={{
                    options: blockOptions,
                  }}
                />
              </Section>
            </div>

            {/* Analysis State */}
            {conversionState.status === 'analyzing' && (
              <div className={s.loading}>
                <Spinner size={32} />
                <div className={s.progressContainer} style={{ width: '100%', maxWidth: '400px', margin: 'var(--spacing-m) 0 0 0' }}>
                  <div className={s.progressBar}>
                    <div
                      className={s.progressFill}
                      style={{ width: `${conversionState.progressPercentage || 0}%` }}
                    />
                  </div>
                </div>
                <p className={s.loadingText}>{conversionState.progressMessage || 'Analyzing block structure...'}</p>
                {conversionState.progressPercentage !== undefined && (
                   <p className={s.percentageText}>{conversionState.progressPercentage}%</p>
                )}
              </div>
            )}

            {/* Analysis Results */}
            {conversionState.status === 'analyzed' && (
              <div className={s.analysis}>
                <div className={s.card}>
                  <Section title="Analysis Results">
                    <div className={s.analysisGrid}>
                      <div className={s.analysisItem}>
                        <h3><span className={s.iconWrapper}><Icons.Block /></span> Block Details</h3>
                        <div className={s.analysisStat}>
                          <span className={s.statLabel}>Name</span>
                          <span className={s.statValueMain} title={conversionState.analysis.block.name}>
                            {conversionState.analysis.block.name}
                          </span>
                        </div>
                        <div className={s.analysisStat}>
                          <span className={s.statLabel}>API Key</span>
                          <span className={s.statValueCode} title={conversionState.analysis.block.apiKey}>
                            {conversionState.analysis.block.apiKey}
                          </span>
                        </div>
                      </div>
                      <div className={s.analysisItem}>
                        <h3><span className={s.iconWrapper}><Icons.Database /></span> Usage Impact</h3>
                        <div className={s.analysisStat}>
                          <span className={s.statLabel}>Records</span>
                          <span className={s.statValueMain}>{conversionState.analysis.totalAffectedRecords}</span>
                        </div>
                        <div className={s.analysisStat}>
                          <span className={s.statLabel}>Locations</span>
                          <span className={s.statValueMain}>
                            {conversionState.analysis.modularContentFields.length}
                            {conversionState.analysis.modularContentFields.length === 0 && (
                              <span className={s.warningIcon} title="Not used in any fields"> <Icons.Warning /></span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={s.analysisSection}>
                      <h3><span className={s.iconWrapper}><Icons.Field /></span> Fields using this block ({conversionState.analysis.modularContentFields.length})</h3>
                      {conversionState.analysis.modularContentFields.length === 0 ? (
                        <p className={s.emptyFieldsNote}>This block is not used in any fields.</p>
                      ) : (
                        <ul className={s.fieldList}>
                          {conversionState.analysis.modularContentFields.map((field) => {
                            const internalDomain = (ctx.site as { attributes?: { internal_domain?: string | null } })?.attributes?.internal_domain;
                            const fieldUrl = internalDomain 
                              ? `https://${internalDomain}/schema/item_types/${field.parentModelId}#f${field.id}`
                              : undefined;
                            
                            return (
                              <li key={field.id} className={s.fieldListItemClickable}>
                                <a 
                                  href={fieldUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={s.fieldListLink}
                                >
                                  <div className={s.fieldInfo}>
                                    <strong>{field.label}</strong>
                                    <span className={s.fieldApiKey}><Icons.Code /> {field.parentModelApiKey}.{field.apiKey}</span>
                                  </div>
                                  <div className={s.fieldMeta}>
                                    <span className={s.fieldType}>{field.fieldType}</span>
                                    {field.parentIsBlock && <span className={s.badge}>In Block</span>}
                                    {field.localized && <span className={s.badge}>Localized</span>}
                                  </div>
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </Section>

                  <div className={s.conversionOptions}>
                    <SwitchField
                      id="fully-replace-block"
                      name="fully-replace-block"
                      label={
                        <div className={s.labelWithTooltip}>
                          Fully replace original block
                          <div className={s.tooltipContainer}>
                            <Icons.Info />
                            <div className={s.tooltip}>
                              When enabled, the original block model and its field data will be deleted after conversion. The new links field will take its place.
                            </div>
                          </div>
                        </div>
                      }
                      value={fullyReplaceBlock}
                      onChange={(newValue) => setFullyReplaceBlock(newValue)}
                    />
                    <SwitchField
                      id="publish-after-changes"
                      name="publish-after-changes"
                      label={
                        <div className={s.labelWithTooltip}>
                          Publish records after changes
                          <div className={s.tooltipContainer}>
                            <Icons.Info />
                            <div className={s.tooltip}>
                              When enabled, all newly created and updated records will be published after the conversion completes.
                            </div>
                          </div>
                        </div>
                      }
                      value={publishAfterChanges}
                      onChange={(newValue) => setPublishAfterChanges(newValue)}
                    />
                  </div>

                  <div className={s.actions}>
                    <Button onClick={handleReset} buttonType="muted">
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConvert}
                      buttonType={fullyReplaceBlock ? 'negative' : 'primary'}
                      disabled={conversionState.analysis.modularContentFields.length === 0}
                    >
                      {fullyReplaceBlock ? 'Convert & Replace Block' : 'Convert Block to Model'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Converting State */}
            {conversionState.status === 'converting' && (
              <div className={s.card}>
                <div className={s.converting}>
                  <Spinner size={32} />
                  
                  <div className={s.progressHeader}>
                    <h2>Converting...</h2>
                  </div>

                  <div className={s.progressContainer}>
                    <div className={s.progressSteps}>
                      <span>Step {conversionState.progress.currentStep} of {conversionState.progress.totalSteps}</span>
                      <span>{Math.round(conversionState.progress.percentage)}%</span>
                    </div>
                    <div className={s.progressBar}>
                      <div
                        className={s.progressFill}
                        style={{ width: `${conversionState.progress.percentage}%` }}
                      />
                    </div>
                    <p className={s.currentStep}>
                      {conversionState.progress.stepDescription}
                    </p>
                    {conversionState.progress.details && (
                      <p className={s.progressDetails}>{conversionState.progress.details}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Success State */}
            {conversionState.status === 'success' && (
              <div className={s.card}>
                <div className={s.success}>
                  <div className={s.successIcon}><Icons.Check /></div>
                  <h2 className={s.successTitle}>Conversion Complete!</h2>
                  
                  <div className={s.successStats}>
                    <div className={s.statItem}>
                      <span className={s.statValue}>{conversionState.result.migratedRecords}</span>
                      <span className={s.statLabel}>Records Migrated</span>
                    </div>
                    <div className={s.statDivider} />
                    <div className={s.statItem}>
                      <span className={s.statValue}>{conversionState.result.convertedFields}</span>
                      <span className={s.statLabel}>Fields Converted</span>
                    </div>
                  </div>

                  <div className={s.successDetails}>
                    <p>
                      New Model Created: <strong>{conversionState.result.newModelApiKey}</strong>
                    </p>
                  </div>

                  <div className={s.actions} style={{ justifyContent: 'center' }}>
                    <Button onClick={handleReset} buttonType="primary">
                      Convert Another Block
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Error State */}
            {conversionState.status === 'error' && (
              <div className={s.card}>
                <div className={s.error}>
                  <h2>Something went wrong</h2>
                  <p>{conversionState.message}</p>
                  <Button onClick={handleReset} buttonType="primary">
                    Try Again
                  </Button>
                </div>
              </div>
            )}
          </Form>
        )}
      </div>
    </Canvas>
  );
}
