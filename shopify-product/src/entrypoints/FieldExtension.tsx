import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import Link from 'datocms-react-ui/Link';
import get from 'lodash-es/get';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import EntryList from '../components/field/EntryList';
import type { ActionEnv } from '../components/field/editorActions';
import fieldStyles from '../components/field/FieldParts.module.css';
import InvalidValue from '../components/field/InvalidValue';
import {
  FormatMismatchNotice,
  LegacyDriftNotice,
  LoadErrorNotice,
  SETTINGS_LINK_LABEL,
} from '../components/field/Notices';
import { useStableMembership } from '../components/field/stableValues';
import {
  type EditorActions,
  useEditorActions,
} from '../components/field/useEditorActions';
import { useFieldClients } from '../components/field/useFieldClients';
import {
  FIELD_ACTION_ATTRIBUTE,
  type FieldFeedback,
  useFieldFeedback,
} from '../components/field/useFieldFeedback';
import {
  type Hydration,
  useHydration,
  usePrimaryNodes,
} from '../components/field/useHydration';
import { useLegacyDrift } from '../components/field/useLegacyDrift';
import { useOptimisticOrder } from '../components/field/useOptimisticOrder';
import { useCapabilities } from '../components/shared/useCapabilities';
import { useDeepStable } from '../components/shared/useDeepStable';
import { MagnifyingGlassIcon } from '../icons';
import {
  buildRowModel,
  CLEAR_FAILED_MESSAGE,
  connectionProblemCause,
  convertBlocked,
  convertProblem,
  emptyLabel,
  formatMismatchMessage,
  invalidValueTitle,
  isConnectionProblem,
  isFirstLoad,
  isFormatMismatch,
  kindNoun,
  type LimitsSummary,
  legacyDriftSummary,
  limitsSummary,
  loadErrorMessage,
  loadErrorTitle,
  pluginSettingsPath,
  type RowModel,
  settingsStep,
  storedDocumentShop,
  unresolvedSummary,
} from '../lib/fieldValue';
import type { LegacyDrift } from '../lib/legacy';
import {
  isPluginConfigured,
  isStoreUsable,
  normalizeFieldParameters,
  normalizePluginParameters,
  resolveFieldStore,
} from '../lib/parameters';
import { parseStoredValue } from '../lib/references';
import { ShopifyClientError } from '../lib/shopifyClient';
import { TEXTS } from '../texts';
import type {
  FieldParametersV1,
  FieldType,
  ParsedStoredValue,
  StoreConnection,
} from '../types';

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

/** The plugin settings, for the roles that can open them; else undefined. */
function settingsPathFor(ctx: RenderFieldExtensionCtx): string | undefined {
  if (!canEditSchema(ctx)) return undefined;
  return pluginSettingsPath({
    pluginId: ctx.plugin.id,
    environment: ctx.environment,
    isEnvironmentPrimary: ctx.isEnvironmentPrimary,
  });
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
      <Callout>
        The Shopify editor works only on Single-line string and JSON fields.
      </Callout>
    );
  }
  const settingsPath = settingsPathFor(ctx);
  if (setup.status === 'store-missing') {
    return (
      <Callout tone="warning" title="Store not connected">
        This field uses {setup.shopDomain}, which isn't connected to the plugin.{' '}
        {settingsPath ? (
          <>
            <Link to={settingsPath}>{SETTINGS_LINK_LABEL}</Link> to connect it
            again.
          </>
        ) : (
          'Ask an administrator to connect it again.'
        )}
      </Callout>
    );
  }
  // A role that can't open the settings gets only its next step.
  if (!settingsPath) {
    return (
      <Callout tone="warning">
        Ask an administrator to connect a Shopify store in the plugin settings.
      </Callout>
    );
  }
  return (
    <Callout tone="warning">
      No Shopify store is connected yet.{' '}
      <Link to={settingsPath}>{SETTINGS_LINK_LABEL}</Link> to connect one.
    </Callout>
  );
}

// ---------------------------------------------------------------------------
// Invalid values
// ---------------------------------------------------------------------------

function shopMismatchMessage(
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

/**
 * "Clear value", behind a confirmation; focus then goes to the empty slot
 * ("Browse Shopify", or "Add …" for a multiple field).
 */
async function clearValue(
  ctx: RenderFieldExtensionCtx,
  feedback: FieldFeedback,
) {
  const token = feedback.expect(['browse', 'add']);
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
  limits: LimitsSummary;
  inventory: boolean;
};

/** Nothing to show yet: the loading state stands in for the rows. */
function showsFirstLoad(rows: readonly RowModel[], hydration: Hydration) {
  return isFirstLoad(rows) && hydration.status === 'loading';
}

/**
 * An empty single field: the slot is the "Browse Shopify" button. (A
 * multiple field's slot stands for its card: see `EntryList`.)
 */
function EmptyValue({
  params,
  readOnly,
  onBrowse,
}: {
  params: FieldParametersV1;
  readOnly: boolean;
  onBrowse: () => void;
}) {
  const message = emptyLabel(params.kind, params.cardinality);
  if (readOnly) return <EmptySlot message={message} />;
  return (
    <div {...{ [FIELD_ACTION_ATTRIBUTE]: 'browse' }}>
      <EmptySlot
        message={message}
        action={{
          label: 'Browse Shopify',
          icon: MagnifyingGlassIcon,
          onClick: onBrowse,
        }}
      />
    </div>
  );
}

function Rows({
  ctx,
  params,
  rows,
  hydration,
  actions,
  limits,
  inventory,
}: ViewProps) {
  if (rows.length === 0 && params.cardinality !== 'multiple') {
    return (
      <EmptyValue
        params={params}
        readOnly={ctx.disabled}
        onBrowse={actions.browse}
      />
    );
  }
  if (showsFirstLoad(rows, hydration)) {
    return (
      <BlankSlate
        placement="inline"
        small
        loading
        title={`Loading the ${kindNoun(params.kind, rows.length)}`}
      />
    );
  }
  return (
    <EntryList
      params={params}
      rows={rows}
      actions={actions}
      limits={limits}
      locale={ctx.ui.locale}
      inventory={inventory}
      readOnly={ctx.disabled}
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
 * permissions, the store address), admins get a link to them instead of a
 * "Try again" that can't help, and other roles are pointed to an
 * administrator.
 */
function LoadError({
  ctx,
  params,
  rows,
  hydration,
  onRetry,
}: Pick<NoticesProps, 'ctx' | 'params' | 'rows' | 'hydration' | 'onRetry'>) {
  const { error } = hydration;
  const settingsPath = isConnectionProblem(error)
    ? settingsPathFor(ctx)
    : undefined;
  // Admins keep the full message (what to enable in Shopify), except for a
  // rejected token, whose full message already sends them to the settings.
  const rejectedToken =
    error instanceof ShopifyClientError && error.code === 'unauthorized';
  return (
    <LoadErrorNotice
      title={loadErrorTitle(params.kind, rows.length)}
      message={
        settingsPath && rejectedToken
          ? connectionProblemCause(error)
          : loadErrorMessage(error, canEditSchema(ctx))
      }
      retrying={hydration.retrying}
      settings={
        settingsPath
          ? { path: settingsPath, step: settingsStep(error) }
          : undefined
      }
      onRetry={settingsPath ? undefined : onRetry}
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
  // Rows that don't show carry their pill and Replace; the reason is said
  // once, above the card.
  const unresolved = unresolvedSummary(
    rows.filter((row) => row.state === 'unresolved').map((row) => row.entry),
    rows.length,
    ctx.ui.locale,
  );
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
      {unresolved && <Callout tone="warning">{unresolved}</Callout>}
      {isFormatMismatch(parsed.format, params.format) &&
        !convertBlocked(rows) && (
          <FormatMismatchNotice
            message={formatMismatchMessage(
              parsed.format,
              params.kind,
              rows.length,
            )}
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
    <div className="visually-hidden" role="status">
      {hydration.status === 'loading' ? 'Loading Shopify data…' : ''}
    </div>
  );
}

/**
 * "Try again": the error callout stays, with the button busy, until Shopify
 * answers. Focus moves to the first row (the busy button can't keep it).
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
  const limits = limitsSummary(params, rows.length, ctx.ui.locale);
  const view: ViewProps = {
    ctx,
    params,
    rows,
    hydration,
    actions,
    limits,
    inventory,
  };

  // An editable multiple field keeps the gutter of the drag handles at its
  // left, also while it can't drag yet, so nothing moves when a second item
  // arrives: the notices, the card and its limits share its left edge.
  const gutter = params.cardinality === 'multiple' && !ctx.disabled;
  return (
    <>
      <LoadingStatus hydration={hydration} />
      <div className={gutter ? fieldStyles.gutter : undefined}>
        <ValueNotices
          {...view}
          parsed={parsed}
          drift={drift}
          onRetry={onRetry}
        />
        <Rows {...view} />
      </div>
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
      message={
        shopMismatchMessage(failure, store.shopDomain) ?? failure.message
      }
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
      keptNote={failure.code !== 'unsupported-version'}
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
 * says what changed. The status regions come first, so the last element of
 * the field is its content (a callout drops its bottom margin there).
 */
export default function FieldExtension({ ctx }: Props) {
  const { rootRef, feedback, message } = useFieldFeedback();
  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      <div ref={rootRef}>
        <div className="visually-hidden" role="status">
          {message}
        </div>
        <FieldEditor ctx={ctx} feedback={feedback} />
      </div>
    </Canvas>
  );
}
