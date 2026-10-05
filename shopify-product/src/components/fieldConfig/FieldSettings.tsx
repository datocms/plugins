import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import {
  getActiveStores,
  normalizePluginParameters,
  resolveFieldStore,
} from '../../lib/parameters';
import type {
  FieldType,
  PluginParametersV3,
  StoreConnection,
} from '../../types';
import { Button } from '../../ui/Button';
import Callout from '../shared/Callout';
import { changesSinceSaved, NO_CHANGES, type SavedChanges } from './changes';
import {
  CARDINALITY_CHANGE_NOTICE,
  EXAMPLE_SHOP_PLACEHOLDER,
  FORMAT_CHANGE_NOTICE,
  LEGACY_NOTICE,
  REPAIR_NOTICE,
  storeChangeNotice,
  UNSUPPORTED_NOTICE,
} from './copy';
import {
  withCardinality,
  withFormat,
  withKind,
  withScope,
  withSnapshot,
  withStore,
} from './draft';
import styles from './FieldSettings.module.css';
import {
  controlErrors,
  type ErrorPlacement,
  type FieldErrors,
  readErrors,
  strayErrors,
  type VisibleControls,
  visibleControls,
} from './errors';
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

/** The per-field settings for a string or JSON field. */
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

  return (
    <div className={styles.form}>
      <Notices
        config={config}
        fieldType={fieldType}
        stray={strayErrors(allErrors, visible, placement)}
      />
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
      />
      <StoredValueExample
        fieldType={fieldType}
        params={config.effective}
        shopDomain={
          store?.shopDomain ?? params.shopDomain ?? EXAMPLE_SHOP_PLACEHOLDER
        }
      />
    </div>
  );
}

/**
 * A control and the warning that belongs to it. The wrapper is always there,
 * so the control keeps its focus when the warning appears.
 */
function WithNotice({
  notice,
  children,
}: {
  notice: string | null;
  children: ReactNode;
}) {
  return (
    <div className={styles.group}>
      {children}
      {notice && (
        <Callout tone="warning" role="status">
          {notice}
        </Callout>
      )}
    </div>
  );
}

/** Notices about the saved settings, plus errors no visible control can show. */
function Notices({
  config,
  fieldType,
  stray,
}: {
  config: FieldConfigState;
  fieldType: FieldType;
  stray: string[];
}) {
  return (
    <>
      {config.isUnsupported && (
        <Callout tone="warning" role="status">
          {UNSUPPORTED_NOTICE}
        </Callout>
      )}
      {config.isLegacy && (
        <Callout tone="neutral">{LEGACY_NOTICE[fieldType]}</Callout>
      )}
      {stray.length > 0 && (
        <Callout
          tone="danger"
          role="alert"
          actions={
            config.needsRepair ? (
              <Button buttonSize="xxs" onClick={config.repair}>
                Use these settings
              </Button>
            ) : undefined
          }
        >
          {stray.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {config.needsRepair && <p>{REPAIR_NOTICE}</p>}
        </Callout>
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
  const { params } = config.draft;
  const { update } = config;
  return (
    <>
      <KindField
        params={params}
        error={errors.kind}
        onChange={(kind) => update((p) => withKind(p, kind, fieldType))}
      />
      <WithNotice notice={changes.format ? FORMAT_CHANGE_NOTICE : null}>
        <FormatField
          fieldType={fieldType}
          format={params.format}
          error={errors.format}
          onChange={(format) => update((p) => withFormat(p, format, fieldType))}
        />
      </WithNotice>
      {visible.cardinality && (
        <ReferenceOptions
          config={config}
          fieldType={fieldType}
          visible={visible}
          errors={errors}
          changes={changes}
        />
      )}
    </>
  );
}

/** 3–4: how many items and the display snapshot (reference documents only). */
function ReferenceOptions({
  config,
  fieldType,
  visible,
  errors,
  changes,
}: SectionProps) {
  const { params, limits } = config.draft;
  return (
    <>
      <WithNotice
        notice={changes.cardinality ? CARDINALITY_CHANGE_NOTICE : null}
      >
        <CardinalityField
          params={params}
          error={errors.cardinality}
          onChange={(cardinality) =>
            config.update((p) => withCardinality(p, cardinality, fieldType))
          }
        />
      </WithNotice>
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
            config.update((p) => withSnapshot(p, snapshot, fieldType))
          }
        />
      )}
    </>
  );
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
}: SectionProps & {
  plugin: PluginParametersV3;
  stores: StoreConnection[];
  store: StoreConnection | null;
}) {
  const { params } = config.draft;
  const { update } = config;
  const notice = changes.previousStore
    ? storeChangeNotice(changes.previousStore)
    : null;
  return (
    <>
      {visible.store && (
        <WithNotice notice={notice}>
          <StoreField
            stores={stores}
            store={store}
            shopDomain={params.shopDomain}
            error={errors.shopDomain}
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
        </WithNotice>
      )}
      {visible.scope && (
        <ScopeSection
          kind={params.kind}
          scope={params.scope}
          store={store}
          error={errors.scope}
          onChange={(patch) => update((p) => withScope(p, patch, fieldType))}
        />
      )}
    </>
  );
}
