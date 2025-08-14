import type { SchemaTypes } from '@datocms/cma-client';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Spinner, TextField } from 'datocms-react-ui';
import { defaults, groupBy, map, mapValues, sortBy } from 'lodash-es';
import { useContext, useId, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useForm, useFormState } from 'react-final-form';
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

export default function ConflictsManager({
  exportSchema,
  schema: _schema,
}: Props) {
  const conflicts = useContext(ConflictsContext);
  const { submitting, valid, validating } = useFormState();
  const form = useForm();
  const [nameSuffix, setNameSuffix] = useState(' (Import)');
  const [apiKeySuffix, setApiKeySuffix] = useState('import');
  const nameSuffixId = useId();
  const apiKeySuffixId = useId();
  // Mass action toggles — applied on submit only
  const [selectedItemTypesAction, setSelectedItemTypesAction] = useState<
    'rename' | 'reuse' | null
  >(null);
  const [selectedPluginsAction, setSelectedPluginsAction] = useState<
    'reuse' | 'skip' | null
  >(null);
  const anyBusy = false;
  const apiKeySuffixError = useMemo(() => {
    // Canonical DatoCMS API key pattern for the final key:
    // ^[a-z][a-z0-9_]*[a-z0-9]$
    // We validate the suffix independently but with equivalent character rules
    if (!apiKeySuffix || apiKeySuffix.length === 0) {
      return 'API key suffix is required';
    }
    if (!/^[a-z0-9_]+$/.test(apiKeySuffix)) {
      return 'Only lowercase letters, digits and underscores allowed';
    }
    if (!/^[a-z]/.test(apiKeySuffix)) {
      return 'Suffix must start with a lowercase letter';
    }
    if (!/[a-z0-9]$/.test(apiKeySuffix)) {
      return 'Suffix must end with a letter or digit';
    }
    return undefined;
  }, [apiKeySuffix]);

  if (!conflicts) {
    return null;
  }

  const noPotentialConflicts =
    Object.keys(conflicts.itemTypes).length === 0 &&
    Object.keys(conflicts.plugins).length === 0;

  const groupedItemTypes = defaults(
    mapValues(
      groupBy(
        map(
          conflicts.itemTypes,
          (projectItemType: SchemaTypes.ItemType, exportItemTypeId: string) => {
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

  const sortedPlugins = sortBy(
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

  return (
    <div className="page">
      <div className="conflicts-manager__actions">
        <div style={{ fontWeight: 700, fontSize: '16px' }}>
          Import conflicts
        </div>
      </div>
      <div className="page__content">
        <div className="conflicts-manager__actions">
          {noPotentialConflicts ? (
            <p>
              No conflicts have been found with the existing schema in this
              project.
            </p>
          ) : (
            <p>
              Some conflicts exist with the current schema in this project.
              Before importing, choose how to handle them below.
            </p>
          )}
        </div>

        {!noPotentialConflicts && (
          <div
            className="conflicts-setup surface"
            style={{ position: 'relative' }}
            aria-busy={anyBusy}
          >
            {anyBusy && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(250,252,255,0.6)',
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'all',
                }}
                role="status"
                aria-label="Applying selection"
              >
                <Spinner size={20} />
              </div>
            )}

            <div className="setup-inline">
              <div className="setup-group setup-group--vertical">
                <div className="setup-group__label">
                  Models & blocks (Select One)
                </div>
                <div className="setup-group__content">
                  <div
                    className="choice-list"
                    role="group"
                    aria-label="Models and blocks import strategy"
                  >
                    <Button
                      className={
                        selectedItemTypesAction === 'rename'
                          ? 'choice-button is-selected'
                          : 'choice-button'
                      }
                      aria-pressed={selectedItemTypesAction === 'rename'}
                      type="button"
                      buttonSize="s"
                      fullWidth
                      onClick={() => {
                        flushSync(() => setSelectedItemTypesAction('rename'));
                        form.change('mass.itemTypesStrategy', 'rename');
                        form.change('mass.nameSuffix', nameSuffix);
                        form.change('mass.apiKeySuffix', apiKeySuffix);
                      }}
                      disabled={!!apiKeySuffixError}
                    >
                      Rename all with these suffixes
                    </Button>
                    <Button
                      className={
                        selectedItemTypesAction === 'reuse'
                          ? 'choice-button is-selected'
                          : 'choice-button'
                      }
                      aria-pressed={selectedItemTypesAction === 'reuse'}
                      type="button"
                      buttonSize="s"
                      fullWidth
                      onClick={() => {
                        flushSync(() => setSelectedItemTypesAction('reuse'));
                        form.change('mass.itemTypesStrategy', 'reuseExisting');
                      }}
                    >
                      Reuse existing where possible
                    </Button>
                  </div>

                  {selectedItemTypesAction === 'rename' && (
                    <div
                      className="mass-actions__section"
                      role="group"
                      aria-label="Default rename suffixes"
                    >
                      <div className="mass-actions__section__label">
                        Default suffixes
                      </div>
                      <div className="setup__fields">
                        <TextField
                          id={nameSuffixId}
                          name="mass-name-suffix"
                          label="Model/block name suffix"
                          value={nameSuffix}
                          onChange={(val: string) => {
                            setNameSuffix(val);
                            form.change('mass.nameSuffix', val);
                          }}
                        />
                        <TextField
                          id={apiKeySuffixId}
                          name="mass-apikey-suffix"
                          label="API key suffix"
                          value={apiKeySuffix}
                          onChange={(val: string) => {
                            setApiKeySuffix(val);
                            form.change('mass.apiKeySuffix', val);
                          }}
                          error={apiKeySuffixError}
                        />
                      </div>
                      <div className="setup__hint">
                        These suffixes will be used if you choose to rename
                        conflicting models/blocks.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="setup-group setup-group--vertical">
                <div className="setup-group__label">Plugins (Select One)</div>
                <div className="setup-group__content">
                  <div
                    className="choice-list"
                    role="group"
                    aria-label="Plugins import strategy"
                  >
                    <Button
                      className={
                        selectedPluginsAction === 'reuse'
                          ? 'choice-button is-selected'
                          : 'choice-button'
                      }
                      aria-pressed={selectedPluginsAction === 'reuse'}
                      type="button"
                      buttonSize="s"
                      fullWidth
                      onClick={() => {
                        flushSync(() => setSelectedPluginsAction('reuse'));
                        form.change('mass.pluginsStrategy', 'reuseExisting');
                      }}
                    >
                      Reuse all plugins
                    </Button>
                    <Button
                      className={
                        selectedPluginsAction === 'skip'
                          ? 'choice-button is-selected'
                          : 'choice-button'
                      }
                      aria-pressed={selectedPluginsAction === 'skip'}
                      type="button"
                      buttonSize="s"
                      fullWidth
                      onClick={() => {
                        flushSync(() => setSelectedPluginsAction('skip'));
                        form.change('mass.pluginsStrategy', 'skip');
                      }}
                    >
                      Skip all plugins
                    </Button>
                  </div>
                </div>
              </div>
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
          const proceedDisabled = submitting || !valid || validating || anyBusy;
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
