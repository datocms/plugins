import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import get from 'lodash-es/get';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import EntryRow from '../components/field/EntryRow';
import type { ActionEnv } from '../components/field/editorActions';
import { EmptyState, SetupMessage } from '../components/field/FieldBox';
import fieldStyles from '../components/field/FieldParts.module.css';
import InvalidValue from '../components/field/InvalidValue';
import { LimitHint, ListFooter } from '../components/field/ListFooter';
import {
  FormatMismatchNotice,
  LegacyDriftNotice,
  LoadErrorNotice,
} from '../components/field/Notices';
import SortableRows, {
  type HandleMode,
} from '../components/field/SortableRows';
import { useStableMembership } from '../components/field/stableValues';
import {
  type EditorActions,
  useEditorActions,
} from '../components/field/useEditorActions';
import {
  type FieldFeedback,
  useFieldFeedback,
} from '../components/field/useFieldFeedback';
import { useFieldClients } from '../components/field/useFieldClients';
import {
  type Hydration,
  useHydration,
  usePrimaryNodes,
} from '../components/field/useHydration';
import { useLegacyDrift } from '../components/field/useLegacyDrift';
import { useOptimisticOrder } from '../components/field/useOptimisticOrder';
import { useCapabilities } from '../components/shared/useCapabilities';
import { useDeepStable } from '../components/shared/useDeepStable';
import {
  buildRowModel,
  CLEAR_FAILED_MESSAGE,
  convertProblem,
  formatMismatchMessage,
  invalidValueTitle,
  isConnectionProblem,
  isFirstLoad,
  isFormatMismatch,
  legacyDriftSummary,
  limitsSummary,
  loadErrorMessage,
  loadErrorTitle,
  pluginSettingsPath,
  type RowModel,
  reorderUnavailableReason,
  storedDocumentShop,
} from '../lib/fieldValue';
import { nodeTitle } from '../lib/format';
import type { LegacyDrift } from '../lib/legacy';
import {
  isPluginConfigured,
  isStoreUsable,
  normalizeFieldParameters,
  normalizePluginParameters,
  resolveFieldStore,
} from '../lib/parameters';
import { parseStoredValue } from '../lib/references';
import type {
  FieldParametersV1,
  FieldType,
  ParsedStoredValue,
  StoreConnection,
} from '../types';
import styles from './FieldExtension.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type ParsedValue = Extract<ParsedStoredValue, { ok: true }>;
type ParseFailure = Extract<ParsedStoredValue, { ok: false }>;

type ReadySetup = {
  status: 'ready';
  fieldType: FieldType;
  params: FieldParametersV1;
  store: StoreConnection;
};

type Setup =
  | { status: 'unsupported' }
  | { status: 'not-configured' }
  | { status: 'store-missing'; shopDomain: string }
  | ReadySetup;

// ---------------------------------------------------------------------------
// Setup: field type, plugin settings, the field's store
// ---------------------------------------------------------------------------

function resolveSetup(
  fieldType: string,
  rawFieldParameters: unknown,
  rawPluginParameters: unknown,
): Setup {
  if (fieldType !== 'string' && fieldType !== 'json') {
    return { status: 'unsupported' };
  }
  const pluginParameters = normalizePluginParameters(rawPluginParameters);
  if (!isPluginConfigured(pluginParameters))
    return { status: 'not-configured' };
  const params = normalizeFieldParameters(rawFieldParameters, fieldType);
  const store = resolveFieldStore(pluginParameters, params.shopDomain);
  if (!store) {
    return { status: 'store-missing', shopDomain: params.shopDomain ?? '' };
  }
  if (!isStoreUsable(store)) return { status: 'not-configured' };
  return { status: 'ready', fieldType, params, store };
}

function useFieldSetup(ctx: RenderFieldExtensionCtx): Setup {
  const fieldType = ctx.field.attributes.field_type;
  const rawFieldParameters = useDeepStable(ctx.parameters);
  const rawPluginParameters = useDeepStable(ctx.plugin.attributes.parameters);
  return useMemo(
    () => resolveSetup(fieldType, rawFieldParameters, rawPluginParameters),
    [fieldType, rawFieldParameters, rawPluginParameters],
  );
}

function canEditSchema(ctx: RenderFieldExtensionCtx): boolean {
  return ctx.currentRole.meta.final_permissions.can_edit_schema === true;
}

function openPluginSettings(ctx: RenderFieldExtensionCtx) {
  void ctx.navigateTo(
    pluginSettingsPath({
      pluginId: ctx.plugin.id,
      environment: ctx.environment,
      isEnvironmentPrimary: ctx.isEnvironmentPrimary,
    }),
  );
}

function SetupProblem({
  ctx,
  setup,
}: {
  ctx: RenderFieldExtensionCtx;
  setup: Exclude<Setup, ReadySetup>;
}) {
  if (setup.status === 'unsupported') {
    return (
      <SetupMessage message="The Shopify editor works on Single-line string and JSON fields only" />
    );
  }
  const admin = canEditSchema(ctx);
  const onOpenSettings = admin ? () => openPluginSettings(ctx) : undefined;
  if (setup.status === 'store-missing') {
    return (
      <SetupMessage
        message={
          <span>
            This field uses {setup.shopDomain}, which isn't connected to the
            plugin
            {admin ? '' : '. Ask an administrator to connect it again.'}
          </span>
        }
        onOpenSettings={onOpenSettings}
      />
    );
  }
  return (
    <SetupMessage
      message={
        admin
          ? 'Connect a Shopify store to start picking from your catalog'
          : 'Ask an administrator to connect a Shopify store'
      }
      onOpenSettings={onOpenSettings}
    />
  );
}

// ---------------------------------------------------------------------------
// Invalid values
// ---------------------------------------------------------------------------

function shopMismatchDetail(
  failure: ParseFailure,
  shopDomain: string,
): string | null {
  if (failure.code !== 'shop-mismatch') return null;
  const savedShop = storedDocumentShop(failure.rawValue);
  return savedShop
    ? `It was saved for ${savedShop}, and this field uses ${shopDomain}.`
    : null;
}

async function confirmAndClear(
  ctx: RenderFieldExtensionCtx,
  feedback: FieldFeedback,
) {
  const answer = await ctx.openConfirm({
    title: 'Clear this value?',
    content:
      'Are you sure you want to clear the saved Shopify value? The field will be empty once you save the record.',
    choices: [
      { label: 'Yes, clear the value', value: true, intent: 'negative' },
    ],
    cancel: { label: 'Cancel', value: false },
  });
  if (answer !== true) return;
  await ctx.setFieldValue(ctx.fieldPath, null);
  feedback.announce('Cleared the value');
}

/** "Clear value", behind a confirmation; focus then goes to "Browse Shopify". */
async function clearValue(
  ctx: RenderFieldExtensionCtx,
  feedback: FieldFeedback,
) {
  const token = feedback.expect(['browse']);
  try {
    await confirmAndClear(ctx, feedback);
  } catch {
    void ctx.alert(CLEAR_FAILED_MESSAGE);
  } finally {
    feedback.settle(token);
  }
}

// ---------------------------------------------------------------------------
// A readable value
// ---------------------------------------------------------------------------

type ViewProps = {
  ctx: RenderFieldExtensionCtx;
  params: FieldParametersV1;
  rows: readonly RowModel[];
  hydration: Hydration;
  actions: EditorActions;
  inventory: boolean;
};

/** Nothing to show yet: the spinner stands in for the rows and the footer. */
function showsFirstLoad(rows: readonly RowModel[], hydration: Hydration) {
  return isFirstLoad(rows) && hydration.status === 'loading';
}

/**
 * Multiple fields always keep the handle column, so the rows don't shift
 * when a second item arrives: inert with one item, sortable with more.
 * Disabled fields and single values have none.
 */
function handleMode(
  params: FieldParametersV1,
  count: number,
  disabled: boolean,
): HandleMode {
  if (params.cardinality !== 'multiple' || disabled) return 'none';
  return count > 1 ? 'sortable' : 'inert';
}

function rowLabel(row: RowModel): string {
  return row.node ? nodeTitle(row.node) : row.fallback.label;
}

/**
 * "Browse Shopify" and "Add …" are disabled while another action runs, but
 * not during their own: a disabled button drops keyboard focus.
 */
function browseBlocked(actions: EditorActions): boolean {
  return actions.busy !== null && actions.busy !== 'browse';
}

function Rows({ ctx, params, rows, hydration, actions, inventory }: ViewProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        kind={params.kind}
        cardinality={params.cardinality}
        readOnly={ctx.disabled}
        busy={browseBlocked(actions)}
        onBrowse={actions.browse}
      />
    );
  }
  if (showsFirstLoad(rows, hydration)) {
    return (
      <div className={fieldStyles.loading}>
        <Spinner size={25} placement="centered" />
      </div>
    );
  }
  const items = rows.map((row) => ({ ...row, label: rowLabel(row) }));
  const indexOf = (key: string) => rows.findIndex((row) => row.key === key);
  return (
    <SortableRows
      items={items}
      handles={handleMode(params, rows.length, ctx.disabled)}
      inertReason={reorderUnavailableReason(params.kind)}
      onMove={actions.reorder}
      renderRow={(row, dragHandle, lifted) => (
        <EntryRow
          row={row}
          locale={ctx.ui.locale}
          inventory={inventory}
          readOnly={ctx.disabled || lifted}
          busy={actions.busy !== null}
          onReplace={() => actions.replace(indexOf(row.key))}
          onRemove={() => actions.remove(indexOf(row.key))}
          onUpdateHandle={(handle) => actions.updateHandle(row.key, handle)}
          dragHandle={dragHandle}
          lifted={lifted}
        />
      )}
    />
  );
}

type NoticesProps = {
  ctx: RenderFieldExtensionCtx;
  params: FieldParametersV1;
  parsed: ParsedValue;
  rows: readonly RowModel[];
  hydration: Hydration;
  actions: EditorActions;
  drift: LegacyDrift | null;
  onRetry: () => void;
};

/**
 * Hydration failed. When only the plugin settings can fix it (the token, its
 * permissions, the store address), admins get "Open plugin settings" instead
 * of a "Try again" that can't help, and other roles are pointed to an
 * administrator.
 */
function LoadError({
  ctx,
  params,
  rows,
  hydration,
  onRetry,
}: Pick<NoticesProps, 'ctx' | 'params' | 'rows' | 'hydration' | 'onRetry'>) {
  const admin = canEditSchema(ctx);
  const settingsFix = admin && isConnectionProblem(hydration.error);
  return (
    <LoadErrorNotice
      title={loadErrorTitle(params.kind, rows.length)}
      message={loadErrorMessage(hydration.error, admin)}
      retrying={hydration.retrying}
      onOpenSettings={settingsFix ? () => openPluginSettings(ctx) : undefined}
      onRetry={settingsFix ? undefined : onRetry}
    />
  );
}

function ValueNotices({
  ctx,
  params,
  parsed,
  rows,
  hydration,
  actions,
  drift,
  onRetry,
}: NoticesProps) {
  const busy = actions.busy !== null;
  return (
    <>
      {hydration.status === 'error' && (
        <LoadError
          ctx={ctx}
          params={params}
          rows={rows}
          hydration={hydration}
          onRetry={onRetry}
        />
      )}
      {isFormatMismatch(parsed.format, params.format) && (
        <FormatMismatchNotice
          message={formatMismatchMessage(parsed.format, params.format)}
          problem={convertProblem(params, rows)}
          readOnly={ctx.disabled}
          busy={busy}
          pending={actions.busy === 'convert'}
          onConvert={actions.convert}
        />
      )}
      {drift && (
        <LegacyDriftNotice
          summary={legacyDriftSummary(drift.fields)}
          readOnly={ctx.disabled}
          busy={busy}
          pending={actions.busy === 'refresh'}
          onRefresh={actions.refreshLegacy}
        />
      )}
    </>
  );
}

function LoadingStatus({ hydration }: { hydration: Hydration }) {
  return (
    <div className="dl-sr-only" role="status">
      {hydration.status === 'loading' ? 'Loading Shopify data…' : ''}
    </div>
  );
}

/**
 * "Try again": the error callout stays, with a spinner, until Shopify
 * answers. When it then goes away, focus moves to the first row.
 */
function useRetry(hydration: Hydration, feedback: FieldFeedback) {
  const token = useRef<number | null>(null);
  const { retry, retrying } = hydration;
  useEffect(() => {
    if (retrying || token.current === null) return;
    feedback.settle(token.current);
    token.current = null;
  }, [retrying, feedback]);
  return useCallback(() => {
    token.current = feedback.expect(['first-row', 'add', 'browse']);
    retry();
  }, [feedback, retry]);
}

type ValueEditorProps = {
  ctx: RenderFieldExtensionCtx;
  setup: ReadySetup;
  parsed: ParsedValue;
  feedback: FieldFeedback;
};

function ValueEditor({ ctx, setup, parsed, feedback }: ValueEditorProps) {
  const { fieldType, params, store } = setup;
  const { base, legacy, client } = useFieldClients(
    store,
    ctx.field.attributes.localized,
    ctx.locale,
  );
  const isLegacy = parsed.format === 'legacyProductJson';
  const entries = useStableMembership(parsed.entries);
  // Stores saved without capabilities detect them here too, so stock
  // counts show once the token turns out to have the inventory scope.
  const { inventory } = useCapabilities(base);
  const hydration = useHydration(client, entries, isLegacy, inventory);
  // Shopify translates handles: with a language, drift is checked against
  // the handles a context-free frontend sees.
  const translated = Boolean(client?.context.language);
  const primaryNodes = usePrimaryNodes(
    legacy,
    entries,
    translated && !isLegacy,
  );
  const { ordered, setOrder } = useOptimisticOrder(parsed.entries);
  const rows = useMemo(
    () =>
      ordered.map((entry) =>
        buildRowModel(entry, {
          nodes: hydration.nodes,
          status: hydration.status,
          shopDomain: store.shopDomain,
          legacyProduct: parsed.legacyProduct,
          checkHandleDrift: !isLegacy,
          ...(translated ? { handleNodes: primaryNodes } : {}),
        }),
      ),
    [
      ordered,
      hydration.nodes,
      hydration.status,
      store,
      parsed,
      isLegacy,
      translated,
      primaryNodes,
    ],
  );
  const drift = useLegacyDrift(
    legacy,
    isLegacy ? (parsed.entries[0] ?? null) : null,
    parsed.legacyProduct,
    isLegacy && !isFormatMismatch(parsed.format, params.format),
  );
  const env: ActionEnv = {
    ctx,
    fieldType,
    params,
    store,
    client: client ?? base,
    primaryClient: legacy,
    storedFormat: parsed.format,
    storedShop: parsed.shop,
    rows,
    seed: hydration.seed,
    setOrder,
    feedback,
  };
  const actions = useEditorActions(env);
  const onRetry = useRetry(hydration, feedback);
  const limits = limitsSummary(params, rows.length);
  const view: ViewProps = {
    ctx,
    params,
    rows,
    hydration,
    actions,
    inventory,
  };

  return (
    <>
      <ValueNotices {...view} parsed={parsed} drift={drift} onRetry={onRetry} />
      <Rows {...view} />
      {params.cardinality === 'multiple' &&
        rows.length > 0 &&
        !showsFirstLoad(rows, hydration) && (
          <ListFooter
            kind={params.kind}
            limits={limits}
            readOnly={ctx.disabled}
            busy={browseBlocked(actions)}
            onAdd={actions.browse}
          />
        )}
      {!ctx.disabled && !showsFirstLoad(rows, hydration) && (
        <LimitHint
          message={limits.aboveMax ?? limits.belowMin}
          warning={rows.length > 0}
        />
      )}
      <LoadingStatus hydration={hydration} />
    </>
  );
}

const NO_ROWS: readonly RowModel[] = [];
const NO_OP = () => undefined;

type InvalidProps = {
  ctx: RenderFieldExtensionCtx;
  setup: ReadySetup;
  failure: ParseFailure;
  feedback: FieldFeedback;
};

/**
 * A value saved for another store: "Pick again" opens the picker for this
 * field's store with nothing selected, and saves the pick over the old
 * value. Picking is the explicit replacement, so there's no confirmation.
 */
function ShopMismatchValue({ ctx, setup, failure, feedback }: InvalidProps) {
  const { fieldType, params, store } = setup;
  const { base, legacy } = useFieldClients(store, false, ctx.locale);
  const actions = useEditorActions({
    ctx,
    fieldType,
    params,
    store,
    client: base,
    primaryClient: legacy,
    storedFormat: null,
    storedShop: null,
    rows: NO_ROWS,
    seed: NO_OP,
    setOrder: NO_OP,
    feedback,
  });
  return (
    <InvalidValue
      title={invalidValueTitle(failure.code)}
      message={failure.message}
      detail={shopMismatchDetail(failure, store.shopDomain)}
      rawValue={failure.rawValue}
      readOnly={ctx.disabled}
      onClear={() => void clearValue(ctx, feedback)}
      onPickAgain={actions.browse}
      picking={actions.busy === 'browse'}
    />
  );
}

function InvalidStoredValue(props: InvalidProps) {
  const { ctx, failure, feedback } = props;
  if (failure.code === 'shop-mismatch') return <ShopMismatchValue {...props} />;
  return (
    <InvalidValue
      title={invalidValueTitle(failure.code)}
      message={failure.message}
      rawValue={failure.rawValue}
      readOnly={ctx.disabled}
      onClear={() => void clearValue(ctx, feedback)}
    />
  );
}

function ConnectedField({
  ctx,
  setup,
  feedback,
}: {
  ctx: RenderFieldExtensionCtx;
  setup: ReadySetup;
  feedback: FieldFeedback;
}) {
  const rawValue = useDeepStable(get(ctx.formValues, ctx.fieldPath) as unknown);
  const { fieldType, params, store } = setup;
  const parsed = useMemo(
    () =>
      parseStoredValue(rawValue, {
        fieldType,
        fieldParameters: params,
        shopDomain: store.shopDomain,
      }),
    [rawValue, fieldType, params, store],
  );
  if (!parsed.ok) {
    return (
      <InvalidStoredValue
        ctx={ctx}
        setup={setup}
        failure={parsed}
        feedback={feedback}
      />
    );
  }
  return (
    <ValueEditor ctx={ctx} setup={setup} parsed={parsed} feedback={feedback} />
  );
}

function FieldEditor({ ctx, feedback }: Props & { feedback: FieldFeedback }) {
  const setup = useFieldSetup(ctx);
  if (setup.status !== 'ready') return <SetupProblem ctx={ctx} setup={setup} />;
  return <ConnectedField ctx={ctx} setup={setup} feedback={feedback} />;
}

/**
 * The Shopify field editor for string and JSON fields. It draws only the
 * control (the host draws the label, hint and errors) and writes the value
 * only when an editor acts: rendering, hydrating or saving the record never
 * changes it. After an action, focus stays in the field and a status region
 * says what changed.
 */
export default function FieldExtension({ ctx }: Props) {
  const { rootRef, feedback, message } = useFieldFeedback();
  return (
    <Canvas ctx={ctx}>
      <div ref={rootRef} className={`dl-kit-form-parity ${styles.root}`}>
        <FieldEditor ctx={ctx} feedback={feedback} />
        <div className="dl-sr-only" role="status">
          {message}
        </div>
      </div>
    </Canvas>
  );
}
