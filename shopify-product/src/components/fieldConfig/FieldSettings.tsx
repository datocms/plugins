import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Link from 'datocms-react-ui/Link';
import { pluginSettingsPath } from '../../lib/fieldValue';
import {
  getActiveStores,
  isPluginConfigured,
  normalizePluginParameters,
  resolveFieldStore,
} from '../../lib/parameters';
import type {
  FieldType,
  PluginParametersV3,
  StoreConnection,
} from '../../types';
import { SETTINGS_LINK_LABEL } from '../field/Notices';
import { changesSinceSaved, NO_CHANGES, type SavedChanges } from './changes';
import {
  CARDINALITY_CHANGE_NOTICE,
  EXAMPLE_SHOP_PLACEHOLDER,
  FORMAT_CHANGE_NOTICE,
  LEGACY_NOTICE,
  LEGACY_NOTICE_TITLE,
  REPAIR_NOTICE,
  storeChangeNotice,
  UNSUPPORTED_NOTICE,
  UNSUPPORTED_NOTICE_TITLE,
} from './copy';
import {
  withCardinality,
  withFormat,
  withKind,
  withScope,
  withSnapshot,
  withStore,
} from './draft';
import {
  controlErrors,
  type ErrorPlacement,
  type FieldErrors,
  readErrors,
  strayErrors,
  type VisibleControls,
  visibleControls,
} from './errors';
import { CalloutWithAction } from './notices';
import ScopeSection from './ScopeSection';
import StoredValueExample from './StoredValueExample';
import StoreField from './StoreField';
import { type FieldConfigState, useFieldConfig } from './useFieldConfig';
import {
  CardinalityField,
  FormatField,
  KindField,
  LimitsFields,
  SnapshotField,
} from './ValueFields';

type Ctx = RenderManualFieldExtensionConfigScreenCtx;

type Props = { ctx: Ctx; fieldType: FieldType };

/**
 * The per-field settings for a string or JSON field: a plain stack of fields
 * inside the host's box, which draws the title and Save.
 */
export default function FieldSettings({ ctx, fieldType }: Props) {
  const config = useFieldConfig(ctx, fieldType);
  const { params } = config.draft;
  const plugin = normalizePluginParameters(ctx.plugin.attributes.parameters);
  const stores = getActiveStores(plugin);
  const store = resolveFieldStore(plugin, params.shopDomain);
  const changes = config.saved
    ? changesSinceSaved(config.saved, config.effective, plugin)
    : NO_CHANGES;
  const visible = visibleControls(params, {
    count: stores.length,
    fieldStoreMissing: Boolean(params.shopDomain) && !store,
    storeChanged: changes.previousStore !== null,
  });
  const placement: ErrorPlacement = {
    showsUnsupported: config.isUnsupported,
    repairing: config.needsRepair,
  };
  const allErrors = readErrors(ctx.errors);
  const errors = controlErrors(allErrors, placement);
  const settingsPath = pluginSettingsPath({
    pluginId: ctx.plugin.id,
    environment: ctx.environment,
    isEnvironmentPrimary: ctx.isEnvironmentPrimary,
  });
  const pluginConfigured = isPluginConfigured(plugin);

  return (
    <>
      <Notices
        config={config}
        stray={strayErrors(allErrors, visible, placement)}
      />
      {!pluginConfigured && (
        <Callout>
          No Shopify store is connected yet.{' '}
          <Link to={settingsPath}>{SETTINGS_LINK_LABEL}</Link> to connect one.
        </Callout>
      )}
      <ValueSettings
        config={config}
        fieldType={fieldType}
        visible={visible}
        errors={errors}
        changes={changes}
      />
      <StoreSettings
        config={config}
        fieldType={fieldType}
        plugin={plugin}
        stores={stores}
        store={store}
        visible={visible}
        errors={errors}
        changes={changes}
        pluginConfigured={pluginConfigured}
        settingsPath={settingsPath}
      />
      <StoredValueExample
        fieldType={fieldType}
        params={config.effective}
        shopDomain={
          store?.shopDomain ?? params.shopDomain ?? EXAMPLE_SHOP_PLACEHOLDER
        }
      />
    </>
  );
}

/** The validation errors have no period: here they are sentences. */
function asSentence(message: string): string {
  return message.endsWith('.') ? message : `${message}.`;
}

/** Notices about the saved settings, plus errors no visible control can show. */
function Notices({
  config,
  stray,
}: {
  config: FieldConfigState;
  stray: string[];
}) {
  return (
    <>
      {config.isUnsupported && (
        <Callout tone="warning" title={UNSUPPORTED_NOTICE_TITLE}>
          {UNSUPPORTED_NOTICE}
        </Callout>
      )}
      {config.isLegacy && (
        <Callout title={LEGACY_NOTICE_TITLE}>{LEGACY_NOTICE}</Callout>
      )}
      {stray.length > 0 && (
        <CalloutWithAction
          tone="danger"
          title="These settings aren't valid"
          action={
            config.needsRepair
              ? { label: 'Use these settings', onClick: config.repair }
              : undefined
          }
        >
          {[
            ...stray.map(asSentence),
            ...(config.needsRepair ? [REPAIR_NOTICE] : []),
          ].join(' ')}
        </CalloutWithAction>
      )}
    </>
  );
}

type SectionProps = {
  config: FieldConfigState;
  fieldType: FieldType;
  visible: VisibleControls;
  errors: FieldErrors;
  changes: SavedChanges;
};

/** 1–4: what editors pick, how it's stored, how many, the snapshot. */
function ValueSettings({
  config,
  fieldType,
  visible,
  errors,
  changes,
}: SectionProps) {
  const { params, limits } = config.draft;
  const { update } = config;
  return (
    <>
      <KindField
        params={params}
        error={errors.kind}
        onChange={(kind) => update((p) => withKind(p, kind, fieldType))}
      />
      <FormatField
        fieldType={fieldType}
        format={params.format}
        error={errors.format}
        notice={changes.format ? FORMAT_CHANGE_NOTICE : null}
        onChange={(format) => update((p) => withFormat(p, format, fieldType))}
      />
      {visible.cardinality && (
        <CardinalityField
          params={params}
          error={errors.cardinality}
          notice={changes.cardinality ? CARDINALITY_CHANGE_NOTICE : null}
          onChange={(cardinality) =>
            update((p) => withCardinality(p, cardinality, fieldType))
          }
        />
      )}
      {visible.limits && (
        <LimitsFields
          limits={limits}
          errors={{ min: errors.min, max: errors.max }}
          onChange={config.updateLimits}
        />
      )}
      {visible.snapshot && (
        <SnapshotField
          value={params.snapshot}
          error={errors.snapshot}
          onChange={(snapshot) =>
            update((p) => withSnapshot(p, snapshot, fieldType))
          }
        />
      )}
    </>
  );
}

/**
 * The store the field points to, or pointed to when it was saved, when the
 * plugin settings no longer have it; else null.
 */
function removedStoreDomain(
  plugin: PluginParametersV3,
  current: string | undefined,
  saved: string | undefined,
): string | null {
  for (const domain of [current, saved]) {
    if (domain && !resolveFieldStore(plugin, domain)) return domain;
  }
  return null;
}

/** 5–6: the store (with several) and the limits on what editors see. */
function StoreSettings({
  config,
  fieldType,
  plugin,
  stores,
  store,
  visible,
  errors,
  changes,
  pluginConfigured,
  settingsPath,
}: SectionProps & {
  plugin: PluginParametersV3;
  stores: StoreConnection[];
  store: StoreConnection | null;
  pluginConfigured: boolean;
  settingsPath: string;
}) {
  const { params } = config.draft;
  const { update } = config;
  return (
    <>
      {visible.store && (
        <StoreField
          stores={stores}
          store={store}
          shopDomain={params.shopDomain}
          removedDomain={removedStoreDomain(
            plugin,
            params.shopDomain,
            config.saved?.shopDomain,
          )}
          error={errors.shopDomain}
          notice={
            changes.previousStore
              ? storeChangeNotice(changes.previousStore)
              : null
          }
          onChange={(domain) =>
            update((p) =>
              withStore(
                p,
                domain,
                fieldType,
                resolveFieldStore(plugin, p.shopDomain)?.shopDomain,
              ),
            )
          }
        />
      )}
      {visible.scope && (
        <ScopeSection
          kind={params.kind}
          scope={params.scope}
          store={store}
          pluginConfigured={pluginConfigured}
          settingsPath={settingsPath}
          error={errors.scope}
          onChange={(patch) => update((p) => withScope(p, patch, fieldType))}
        />
      )}
    </>
  );
}
