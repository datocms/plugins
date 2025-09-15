import type { SchemaTypes } from '@datocms/cma-client';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, TextField } from 'datocms-react-ui';
import { defaults, groupBy, map, mapValues, sortBy } from 'lodash-es';
import { type ReactNode, useContext, useId, useMemo } from 'react';
import {
  type FieldMetaState,
  Field,
  useForm,
  useFormState,
} from 'react-final-form';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';

type Props = {
  exportSchema: ExportSchema;
  schema: ProjectSchema;
  // ctx is currently unused; keep for future enhancements
  ctx?: RenderPageCtx;
};

function resolveFieldError(meta: FieldMetaState<unknown> | undefined) {
  if (!meta) {
    return undefined;
  }

  const message = meta.error || meta.submitError;
  if (!message) {
    return undefined;
  }

  if (meta.touched || meta.submitFailed || meta.dirtySinceLastSubmit) {
    return message;
  }

  return undefined;
}

type MassStrategyCardProps = {
  checked: boolean;
  children?: ReactNode;
  description: string;
  disabled?: boolean;
  id: string;
  label: string;
  onToggle: (checked: boolean) => void;
};

function formatConflictCount(count: number) {
  return `${count} conflict${count === 1 ? '' : 's'}`;
}

type MassStrategySectionProps = {
  children: ReactNode;
  conflictCount: number;
  summary: string;
  title: string;
};

function MassStrategyCard({
  checked,
  children,
  description,
  disabled,
  id,
  label,
  onToggle,
}: MassStrategyCardProps) {
  const classNames = ['mass-choice'];
  if (checked) {
    classNames.push('mass-choice--active');
  }
  if (disabled) {
    classNames.push('mass-choice--disabled');
  }

  return (
    <div className={classNames.join(' ')}>
      <div className="mass-choice__header">
        <input
          id={id}
          type="checkbox"
          className="mass-choice__checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          disabled={disabled}
        />
        <label className="mass-choice__label" htmlFor={id}>
          <span className="mass-choice__label-text">{label}</span>
        </label>
      </div>
      <p className="mass-choice__description">{description}</p>
      {checked && children ? (
        <div className="mass-choice__details">{children}</div>
      ) : null}
    </div>
  );
}

function MassStrategySection({
  children,
  conflictCount,
  summary,
  title,
}: MassStrategySectionProps) {
  const classNames = ['mass-section'];
  if (conflictCount === 0) {
    classNames.push('mass-section--calm');
  }

  return (
    <section className={classNames.join(' ')}>
      <header className="mass-section__header">
        <div className="mass-section__header-copy">
          <span className="mass-section__title">{title}</span>
          <span className="mass-section__summary">{summary}</span>
        </div>
        <span className="mass-section__badge">
          {formatConflictCount(conflictCount)}
        </span>
      </header>
      <div className="mass-section__actions">{children}</div>
    </section>
  );
}

export default function ConflictsManager({
  exportSchema,
  schema: _schema,
}: Props) {
  const conflicts = useContext(ConflictsContext);
  const { submitting, valid, validating, values } = useFormState({
    subscription: {
      submitting: true,
      valid: true,
      validating: true,
      values: true,
    },
  });
  const form = useForm();
  const nameSuffixId = useId();
  const apiKeySuffixId = useId();
  const massValues = values?.mass ?? {};
  const itemTypesStrategy =
    (massValues.itemTypesStrategy as 'rename' | 'reuseExisting' | null) ?? null;
  const pluginsStrategy =
    (massValues.pluginsStrategy as 'reuseExisting' | 'skip' | null) ?? null;

  const groupedItemTypes = useMemo(() => {
    if (!conflicts) {
      return { blocks: [], models: [] };
    }

    return defaults(
      mapValues(
        groupBy(
          map(
            conflicts.itemTypes,
            (
              projectItemType: SchemaTypes.ItemType,
              exportItemTypeId: string,
            ) => {
              const exportItemType =
                exportSchema.getItemTypeById(exportItemTypeId);
              return { exportItemTypeId, exportItemType, projectItemType };
            },
          ),
          ({ exportItemType }: { exportItemType: SchemaTypes.ItemType }) =>
            exportItemType?.attributes.modular_block ? 'blocks' : 'models',
        ),
        (group: Array<{ exportItemType: SchemaTypes.ItemType }>) =>
          sortBy(
            group,
            ({ exportItemType }: { exportItemType: SchemaTypes.ItemType }) =>
              getTextWithoutRepresentativeEmojiAndPadding(
                exportItemType.attributes.name,
              ),
          ),
      ),
      { blocks: [], models: [] },
    );
  }, [conflicts, exportSchema]);

  const sortedPlugins = useMemo(() => {
    if (!conflicts) {
      return [] as Array<{
        exportPluginId: string;
        exportPlugin: SchemaTypes.Plugin;
        projectPlugin: SchemaTypes.Plugin;
      }>;
    }

    return sortBy(
      map(
        conflicts.plugins,
        (projectPlugin: SchemaTypes.Plugin, exportPluginId: string) => {
          const exportPlugin = exportSchema.getPluginById(exportPluginId);
          return { exportPluginId, exportPlugin, projectPlugin };
        },
      ),
      ({ exportPlugin }: { exportPlugin: SchemaTypes.Plugin }) =>
        exportPlugin.attributes.name,
    );
  }, [conflicts, exportSchema]);

  if (!conflicts) {
    return null;
  }

  const itemTypeConflictCount =
    groupedItemTypes.blocks.length + groupedItemTypes.models.length;
  const pluginConflictCount = sortedPlugins.length;
  const canApplyItemTypeMass = itemTypeConflictCount > 0;
  const canApplyPluginMass = pluginConflictCount > 0;

  const noPotentialConflicts =
    itemTypeConflictCount === 0 && pluginConflictCount === 0;

  return (
    <div className="page">
      <div className="conflicts-manager__actions">
        <div style={{ fontWeight: 700, fontSize: '16px' }}>
          Import conflicts
        </div>
      </div>
      <div className="page__content">

        {!noPotentialConflicts && (
          <div className="conflicts-setup surface">
            <div className="mass-strategy-grid">
              <MassStrategySection
                title="Models & blocks"
                conflictCount={itemTypeConflictCount}
                summary={
                  canApplyItemTypeMass
                    ? 'Set the default resolution for detected model/block name clashes.'
                    : 'No model or block conflicts detected in this import.'
                }
              >
                <MassStrategyCard
                  id="mass-itemtypes-rename"
                  label="Rename any conflicting models/blocks"
                  description={
                    canApplyItemTypeMass
                      ? 'Adds suffixes to keep imports distinct.'
                      : 'All clear — no model or block conflicts found.'
                  }
                  checked={canApplyItemTypeMass && itemTypesStrategy === 'rename'}
                  disabled={!canApplyItemTypeMass}
                  onToggle={(checked) => {
                    const nextValue = checked ? 'rename' : null;
                    form.change('mass.itemTypesStrategy', nextValue);
                    if (!checked) {
                      return;
                    }
                    if (!massValues.nameSuffix) {
                      form.change('mass.nameSuffix', ' (Import)');
                    }
                    if (!massValues.apiKeySuffix) {
                      form.change('mass.apiKeySuffix', 'import');
                    }
                  }}
                >
                  <div className="mass-choice__grid">
                    <Field name="mass.nameSuffix">
                      {({ input, meta }) => (
                        <TextField
                          {...input}
                          id={nameSuffixId}
                          label="Name suffix"
                          placeholder="e.g. (Import)"
                          error={resolveFieldError(meta)}
                        />
                      )}
                    </Field>
                    <Field name="mass.apiKeySuffix">
                      {({ input, meta }) => (
                        <TextField
                          {...input}
                          id={apiKeySuffixId}
                          label="API key suffix"
                          placeholder="e.g. import"
                          error={resolveFieldError(meta)}
                        />
                      )}
                    </Field>
                  </div>
                  <p className="mass-choice__hint">
                    Unique combinations are generated automatically if a suffix
                    already exists in the project.
                  </p>
                </MassStrategyCard>
                <MassStrategyCard
                  id="mass-itemtypes-reuse"
                  label="Reuse existing models/blocks when possible"
                  description={
                    canApplyItemTypeMass
                      ? 'Keeps entries mapped to the current schema when types are compatible.'
                      : 'No conflicting models or blocks to reuse.'
                  }
                  checked={
                    canApplyItemTypeMass && itemTypesStrategy === 'reuseExisting'
                  }
                  disabled={!canApplyItemTypeMass}
                  onToggle={(checked) =>
                    form.change(
                      'mass.itemTypesStrategy',
                      checked ? 'reuseExisting' : null,
                    )
                  }
                />
              </MassStrategySection>

              <MassStrategySection
                title="Plugins"
                conflictCount={pluginConflictCount}
                summary={
                  canApplyPluginMass
                    ? 'Choose how conflicting plugins should be treated during the import.'
                    : 'No plugin conflicts detected in this import.'
                }
              >
                <MassStrategyCard
                  id="mass-plugins-reuse"
                  label="Reuse all detected plugins"
                  description={
                    canApplyPluginMass
                      ? 'Resolves clashes by keeping the currently installed versions.'
                      : 'No plugin conflicts detected.'
                  }
                  checked={
                    canApplyPluginMass && pluginsStrategy === 'reuseExisting'
                  }
                  disabled={!canApplyPluginMass}
                  onToggle={(checked) =>
                    form.change(
                      'mass.pluginsStrategy',
                      checked ? 'reuseExisting' : null,
                    )
                  }
                />
                <MassStrategyCard
                  id="mass-plugins-skip"
                  label="Skip installing conflictive plugins"
                  description={
                    canApplyPluginMass
                      ? 'Leaves conflicting extensions out of this import.'
                      : 'All plugins can be imported safely.'
                  }
                  checked={canApplyPluginMass && pluginsStrategy === 'skip'}
                  disabled={!canApplyPluginMass}
                  onToggle={(checked) =>
                    form.change('mass.pluginsStrategy', checked ? 'skip' : null)
                  }
                />
              </MassStrategySection>
            </div>
          </div>
        )}

        <div>
          {groupedItemTypes.models.length > 0 && (
            <div className="conflicts-manager__group">
              <div className="conflicts-manager__group__title">
                Models ({groupedItemTypes.models.length})
              </div>
              <div className="conflicts-manager__group__content">
                {groupedItemTypes.models.map(
                  ({
                    exportItemTypeId,
                    exportItemType,
                    projectItemType,
                  }: {
                    exportItemTypeId: string;
                    exportItemType: SchemaTypes.ItemType;
                    projectItemType: SchemaTypes.ItemType;
                  }) => (
                    <ItemTypeConflict
                      key={exportItemTypeId}
                      exportItemType={exportItemType}
                      projectItemType={projectItemType}
                    />
                  ),
                )}
              </div>
            </div>
          )}

          {groupedItemTypes.blocks.length > 0 && (
            <div className="conflicts-manager__group">
              <div className="conflicts-manager__group__title">
                Block models ({groupedItemTypes.blocks.length})
              </div>
              <div className="conflicts-manager__group__content">
                {groupedItemTypes.blocks.map(
                  ({
                    exportItemTypeId,
                    exportItemType,
                    projectItemType,
                  }: {
                    exportItemTypeId: string;
                    exportItemType: SchemaTypes.ItemType;
                    projectItemType: SchemaTypes.ItemType;
                  }) => (
                    <ItemTypeConflict
                      key={exportItemTypeId}
                      exportItemType={exportItemType}
                      projectItemType={projectItemType}
                    />
                  ),
                )}
              </div>
            </div>
          )}

          {sortedPlugins.length > 0 && (
            <div className="conflicts-manager__group">
              <div className="conflicts-manager__group__title">
                Plugins ({sortedPlugins.length})
              </div>
              <div className="conflicts-manager__group__content">
                {sortedPlugins.map(
                  ({
                    exportPluginId,
                    exportPlugin,
                    projectPlugin,
                  }: {
                    exportPluginId: string;
                    exportPlugin: SchemaTypes.Plugin;
                    projectPlugin: SchemaTypes.Plugin;
                  }) => (
                    <PluginConflict
                      key={exportPluginId}
                      exportPlugin={exportPlugin}
                      projectPlugin={projectPlugin}
                    />
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="page__actions">
        {/** Precompute disabled state to attach tooltip when needed */}
        {(() => {
          return null;
        })()}
        <Button
          type="button"
          fullWidth
          buttonSize="l"
          buttonType="negative"
          onClick={() => {
            // Let parent handle confirmation and state reset
            window.dispatchEvent(new CustomEvent('import:request-cancel'));
          }}
        >
          Cancel
        </Button>
        {(() => {
          const proceedDisabled = submitting || !valid || validating;
          return (
            <div
              title={
                proceedDisabled
                  ? 'Select how to resolve the conflicts before proceeding'
                  : undefined
              }
              style={{ width: '100%' }}
            >
              <Button
                type="submit"
                fullWidth
                buttonSize="l"
                buttonType="primary"
                disabled={proceedDisabled}
                style={proceedDisabled ? { pointerEvents: 'none' } : undefined}
              >
                Proceed with the import
              </Button>
            </div>
          );
        })()}
        <p className="conflicts-manager__actions__reassurance">
          The import will never alter any existing elements in the schema.
        </p>
      </div>
    </div>
  );
}
