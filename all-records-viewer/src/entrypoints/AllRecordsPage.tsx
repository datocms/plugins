import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AllRecordsTable } from '../components/AllRecordsTable';
import { columnSettingsStorageKey } from '../components/columnSettings';
import { FilterDropdown } from '../components/FilterDropdown';
import { Pagination } from '../components/Pagination';
import { SelectionActionBar } from '../components/SelectionActionBar';
import type {
  SelectionActionId,
  SelectionAction as SelectionBarAction,
  TableRecord,
} from '../components/types';
import { useColumnSettings } from '../components/useColumnSettings';
import { MAX_BULK_ITEMS, WORKFLOW_STAGE_MODAL_ID } from '../constants';
import { buildCmaClient } from '../data/cma';
import { collectSelection } from '../data/collectSelection';
import { loadItemsById, loadUploadsById, mapBounded } from '../data/loadById';
import { getRegularModels } from '../data/models';
import {
  previewOrderingField,
  serverOrderBy,
  sortableColumnIds,
} from '../data/ordering';
import { DEFAULT_ORDER_BY, throwIfItemsRequestAborted } from '../data/query';
import {
  availableMoveDestinationIds,
  evaluateMoveSelection,
  evaluateSelection,
  getMoveSelectionContext,
} from '../operations/candidates';
import { executeBulkOperation } from '../operations/execute';
import { identityKey } from '../operations/permissions';
import { bulkErrorMessage, bulkResultMessage } from '../operations/results';
import type {
  BulkOperationProgress,
  BulkOperationRequest,
  BulkOperationResult,
  SelectionAction as BulkSelectionAction,
  MoveSelectionContext,
  PermissionContext,
  SelectionEvaluation,
  SelectionInput,
} from '../operations/types';
import type { RawField } from '../presentation/fields';
import { formatDate } from '../presentation/formatters';
import { createPresentationResolver } from '../presentation/resolver';
import {
  getItemStatus,
  getItemValidity,
  ITEM_STATUS_LABEL,
} from '../presentation/status';
import { buildRecordEditorUrl } from '../state/navigation';
import {
  buildPluginPageUrl,
  clampPage,
  parseQueryState,
  updateQueryState,
} from '../state/queryState';
import {
  compactSelectedItem,
  invertPageSelection,
  retainSelectionForModels,
  setPageSelection,
} from '../state/selection';
import { useDebouncedValue } from '../state/useDebouncedValue';
import { useItemsPage } from '../state/useItemsPage';
import { useModelFields } from '../state/useModelFields';
import { usePresentations } from '../state/usePresentations';
import { useSelectedItemsPage } from '../state/useSelectedItemsPage';
import type { ModelSummary, QueryState, RawItem, RawItemType } from '../types';
import styles from './AllRecordsPage.module.css';

type Props = {
  ctx: RenderPageCtx;
};

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Unpublished changes', value: 'updated' },
  { label: 'Published', value: 'published' },
] as const;

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function itemDate(value: unknown, locale: string, timeZone: string): string {
  if (typeof value !== 'string') {
    return '—';
  }

  return (
    formatDate(value, {
      dateOnly: false,
      locales: [locale],
      timeZone,
    }) ?? '—'
  );
}

function operationLabel(action: BulkSelectionAction): string {
  switch (action) {
    case 'delete':
      return 'Delete';
    case 'publish':
      return 'Publish';
    case 'unpublish':
      return 'Unpublish';
  }
}

function confirmationContent(
  action: BulkSelectionAction | 'move_to_stage',
  evaluation: SelectionEvaluation,
): string {
  const eligible = `${evaluation.eligibleCount} ${
    evaluation.eligibleCount === 1 ? 'record' : 'records'
  }`;
  const scope =
    evaluation.excludedCount > 0
      ? `${eligible} of ${evaluation.selectedCount} selected records are eligible.`
      : `${eligible} will be affected.`;

  if (action === 'delete') {
    return `${scope} This action cannot be undone.`;
  }

  return scope;
}

function rawItemTypes(itemTypes: RenderPageCtx['itemTypes']): RawItemType[] {
  return Object.values(itemTypes).filter(isDefined) as RawItemType[];
}

function modelMap(
  models: readonly ModelSummary[],
): ReadonlyMap<string, ModelSummary> {
  return new Map(models.map((model) => [model.id, model]));
}

function creatorRoleMap(
  users: RenderPageCtx['users'],
  ssoUsers: RenderPageCtx['ssoUsers'],
  owner: RenderPageCtx['owner'],
): ReadonlyMap<string, string | null> {
  const result = new Map<string, string | null>();

  for (const user of Object.values(users ?? {}).filter(isDefined)) {
    result.set(identityKey(user), user.relationships.role.data.id);
  }

  for (const user of Object.values(ssoUsers ?? {}).filter(isDefined)) {
    result.set(identityKey(user), user.relationships.role.data?.id ?? null);
  }

  if (owner) {
    result.set(identityKey(owner), null);
  }

  return result;
}

function recordsLabel(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`;
}

function emptyStateMessage(queryState: QueryState): string {
  return queryState.query || queryState.model || queryState.status
    ? 'No records match the current filters.'
    : 'No readable records are available.';
}

function displayedOrderBy(queryState: QueryState) {
  return queryState.query ? null : (queryState.orderBy ?? DEFAULT_ORDER_BY);
}

function useOrderingState(args: {
  itemTypes: readonly RawItemType[];
  modelId: string | null;
  status: QueryState['status'];
  orderBy: QueryState['orderBy'];
  loadItemTypeFields: RenderPageCtx['loadItemTypeFields'];
  onUnsupportedPreviewOrder: () => void;
}) {
  const selectedItemType = useMemo(
    () =>
      args.modelId
        ? (args.itemTypes.find((itemType) => itemType.id === args.modelId) ??
          null)
        : null,
    [args.itemTypes, args.modelId],
  );
  const loadOrderingFields = useCallback(
    async (modelId: string): Promise<readonly RawField[]> =>
      (await args.loadItemTypeFields(modelId)) as RawField[],
    [args.loadItemTypeFields],
  );
  const modelFieldsState = useModelFields(
    selectedItemType?.id ?? null,
    loadOrderingFields,
  );
  const fields =
    modelFieldsState.modelId === selectedItemType?.id
      ? modelFieldsState.fields
      : [];
  const fieldsLoaded =
    selectedItemType === null ||
    (modelFieldsState.modelId === selectedItemType.id &&
      modelFieldsState.loaded);
  const requestedOrderBy = args.orderBy ?? DEFAULT_ORDER_BY;
  const resolvedServerOrderBy = useMemo(
    () =>
      serverOrderBy({
        orderBy: requestedOrderBy,
        itemType: selectedItemType,
        fields,
      }),
    [fields, requestedOrderBy, selectedItemType],
  );
  const columnIds = useMemo(() => {
    const result = new Set(
      sortableColumnIds({
        itemType: selectedItemType,
        fields,
        fieldsLoaded,
      }),
    );
    if (args.status) {
      result.delete('_status');
    }
    return result;
  }, [args.status, fields, fieldsLoaded, selectedItemType]);

  useEffect(() => {
    if (
      args.orderBy?.startsWith('_preview_') &&
      selectedItemType &&
      fieldsLoaded &&
      previewOrderingField(selectedItemType, fields) === null
    ) {
      args.onUnsupportedPreviewOrder();
    }
  }, [
    args.onUnsupportedPreviewOrder,
    args.orderBy,
    fields,
    fieldsLoaded,
    selectedItemType,
  ]);

  return {
    columnIds,
    pending:
      args.orderBy?.startsWith('_preview_') === true &&
      selectedItemType !== null &&
      !fieldsLoaded,
    serverOrderBy: resolvedServerOrderBy,
  };
}

function evaluatedSelectionBarAction(
  evaluation: SelectionEvaluation,
  onClick: () => void | Promise<void>,
): SelectionBarAction | undefined {
  if (evaluation.eligibleCount === 0) return undefined;

  return {
    disabledReason: evaluation.disabledReason ?? undefined,
    onClick,
  };
}

function buildSelectionBarActions(args: {
  deleteEvaluation: SelectionEvaluation;
  publishEvaluation: SelectionEvaluation;
  unpublishEvaluation: SelectionEvaluation;
  moveEnabled: boolean;
  onDelete: () => void | Promise<void>;
  onPublish: () => void | Promise<void>;
  onUnpublish: () => void | Promise<void>;
  onMove: () => void | Promise<void>;
}): Partial<Record<SelectionActionId, SelectionBarAction>> {
  return {
    delete: evaluatedSelectionBarAction(args.deleteEvaluation, args.onDelete),
    publish: evaluatedSelectionBarAction(
      args.publishEvaluation,
      args.onPublish,
    ),
    unpublish: evaluatedSelectionBarAction(
      args.unpublishEvaluation,
      args.onUnpublish,
    ),
    move: args.moveEnabled ? { onClick: args.onMove } : undefined,
  };
}

type EnabledMoveContext = Extract<MoveSelectionContext, { enabled: true }>;

type MoveDestination = {
  id: string;
  name: string;
};

function reportBulkResult(
  ctx: RenderPageCtx,
  result: BulkOperationResult,
): void {
  const message = bulkResultMessage(result);
  if (result.failed > 0 || result.unprocessed) {
    ctx.alert(message);
  } else {
    ctx.notice(message);
  }
}

async function chooseMoveDestination(args: {
  client: Client;
  ctx: RenderPageCtx;
  moveContext: EnabledMoveContext;
  selectionInput: SelectionInput;
  selectedCount: number;
  signal?: AbortSignal;
}): Promise<MoveDestination | null> {
  const workflow = await args.client.workflows.find(
    args.moveContext.workflowId,
  );
  if (args.signal?.aborted) return null;
  const allowedIds = new Set(
    availableMoveDestinationIds({
      ...args.selectionInput,
      destinationStageIds: workflow.stages.map((stage) => stage.id),
    }),
  );
  const stages = workflow.stages.filter((stage) => allowedIds.has(stage.id));

  if (stages.length === 0) {
    args.ctx.alert(
      'None of the selected records can be moved to another stage.',
    );
    return null;
  }

  const stageId = await args.ctx.openModal({
    id: WORKFLOW_STAGE_MODAL_ID,
    title: 'Move to stage',
    width: 's',
    initialHeight: 260,
    parameters: {
      count: args.selectedCount,
      stages: stages.map((stage) => ({ id: stage.id, name: stage.name })),
    },
  });
  if (typeof stageId !== 'string') return null;

  const destination = stages.find((stage) => stage.id === stageId);
  if (!destination) {
    args.ctx.alert('The selected workflow stage is no longer available.');
    return null;
  }

  return { id: destination.id, name: destination.name };
}

async function confirmSelectionAction(
  ctx: RenderPageCtx,
  action: BulkSelectionAction,
  evaluation: SelectionEvaluation,
): Promise<boolean> {
  const label = operationLabel(action);
  return Boolean(
    await ctx.openConfirm({
      title: `${label} selected records`,
      content: confirmationContent(action, evaluation),
      choices: [
        {
          label,
          value: true,
          intent: action === 'delete' ? 'negative' : 'positive',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    }),
  );
}

async function prepareMoveOperation(args: {
  ctx: RenderPageCtx;
  client: Client;
  moveContext: EnabledMoveContext;
  selectionInput: SelectionInput;
  signal?: AbortSignal;
}): Promise<BulkOperationRequest | null> {
  const destination = await chooseMoveDestination({
    ...args,
    selectedCount: args.selectionInput.items.length,
  });
  if (!destination || args.signal?.aborted) return null;
  const evaluation = evaluateMoveSelection({
    ...args.selectionInput,
    destinationStageId: destination.id,
  });
  if (evaluation.disabledReason) {
    args.ctx.alert(evaluation.disabledReason);
    return null;
  }
  const confirmed = await args.ctx.openConfirm({
    title: `Move selected records to ${destination.name}`,
    content: `${confirmationContent('move_to_stage', evaluation)} Destination: ${destination.name}.`,
    choices: [{ label: 'Move to stage', value: true, intent: 'positive' }],
    cancel: { label: 'Cancel', value: false },
  });
  return confirmed
    ? {
        operation: 'move_to_stage',
        itemIds: evaluation.itemIds,
        stage: destination.id,
      }
    : null;
}

function selectionScaleProps(args: {
  showingSelected: boolean;
  total: number;
  perPage: number;
  selectedCount: number;
  selectionBelongsToCurrentFilter: boolean;
  selectAll: () => Promise<void>;
  collectionProgress: string | null;
  bulkProgress: BulkOperationProgress | null;
  cancel: () => void;
}) {
  return {
    onSelectAllMatching:
      !args.showingSelected &&
      args.total > args.perPage &&
      (!args.selectionBelongsToCurrentFilter || args.selectedCount < args.total)
        ? args.selectAll
        : undefined,
    progressText:
      args.collectionProgress ??
      (args.bulkProgress
        ? `${args.bulkProgress.completed} of ${args.bulkProgress.requested} processed; ${args.bulkProgress.successful} succeeded; ${args.bulkProgress.failed} failed`
        : undefined),
    onCancel:
      args.collectionProgress || args.bulkProgress ? args.cancel : undefined,
  };
}

function displayPage<T>(showingSelected: boolean, selected: T, page: T): T {
  return showingSelected ? selected : page;
}

function synchronizeSelection(
  selected: ReadonlyMap<string, RawItem>,
  currentItems: readonly RawItem[],
): ReadonlyMap<string, RawItem> {
  let next: Map<string, RawItem> | undefined;
  for (const item of currentItems) {
    const previous = selected.get(item.id);
    if (!previous) continue;
    const current = compactSelectedItem(item);
    if (
      JSON.stringify(previous.meta) === JSON.stringify(current.meta) &&
      JSON.stringify(previous.relationships) ===
        JSON.stringify(current.relationships)
    ) {
      continue;
    }
    next ??= new Map(selected);
    next.set(item.id, current);
  }
  return next ?? selected;
}

async function loadCurrentSelection(
  client: Client,
  selected: readonly RawItem[],
  {
    omitMissing = false,
    signal,
  }: { omitMissing?: boolean; signal?: AbortSignal } = {},
): Promise<RawItem[]> {
  const batches: string[][] = [];
  for (let offset = 0; offset < selected.length; offset += 100) {
    batches.push(selected.slice(offset, offset + 100).map((item) => item.id));
  }
  const loaded = (
    await mapBounded(batches, async (ids) => {
      throwIfItemsRequestAborted(signal);
      const items = await loadItemsById(client, ids);
      throwIfItemsRequestAborted(signal);
      // Discard large fields per batch rather than aggregating full records.
      return items.map(compactSelectedItem);
    })
  ).flat();
  const byId = new Map(loaded.map((item) => [item.id, item]));
  const missingMessage =
    'Some selected records no longer exist or cannot be read. Refresh the view and select the records again.';
  const selectedIds = new Set(selected.map((item) => item.id));
  if (
    [...byId.keys()].some((id) => !selectedIds.has(id)) ||
    (!omitMissing && byId.size !== selected.length)
  ) {
    throw new Error(missingMessage);
  }
  return selected.flatMap((item) => {
    const current = byId.get(item.id);
    if (!current && omitMissing) return [];
    if (!current) throw new Error(missingMessage);
    return [current];
  });
}

export default function AllRecordsPage({ ctx }: Props) {
  const queryState = useMemo(
    () => parseQueryState(ctx.location.search),
    [ctx.location.search],
  );
  const [searchInput, setSearchInput] = useState(queryState.query);
  const searchWasEdited = useRef(false);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [selectedById, setSelectedById] = useState<
    ReadonlyMap<string, RawItem>
  >(new Map());
  const selectionFilterScope = useRef<string | null>(null);
  const matchingFilterScope = JSON.stringify([
    queryState.model,
    queryState.status,
    queryState.query,
  ]);
  const [showingSelected, setShowingSelected] = useState(false);
  const [busyAction, setBusyAction] = useState<SelectionActionId | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectionPage, setSelectionPage] = useState(0);
  const [collectingSelection, setCollectingSelection] = useState(false);
  const [collectionProgress, setCollectionProgress] = useState<string | null>(
    null,
  );
  const [bulkProgress, setBulkProgress] =
    useState<BulkOperationProgress | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionLocked = useRef(false);

  const updateLocation = useCallback(
    (patch: Partial<QueryState>) => {
      const next = updateQueryState(queryState, patch);
      const onlyChangesPage = Object.keys(patch).every((key) => key === 'page');
      if (!onlyChangesPage) {
        setShowingSelected(false);
      }

      void ctx.navigateTo(
        buildPluginPageUrl({
          environment: ctx.environment,
          isEnvironmentPrimary: ctx.isEnvironmentPrimary,
          pluginId: ctx.plugin.id,
          state: next,
        }),
      );
    },
    [
      ctx.environment,
      ctx.isEnvironmentPrimary,
      ctx.navigateTo,
      ctx.plugin.id,
      queryState,
    ],
  );
  const clearUnsupportedPreviewOrder = useCallback(
    () => updateLocation({ orderBy: null }),
    [updateLocation],
  );

  useEffect(() => {
    searchWasEdited.current = false;
    setSearchInput(queryState.query);
  }, [queryState.query]);

  useEffect(() => {
    if (!searchWasEdited.current || debouncedSearch !== searchInput) {
      return;
    }

    const normalized = debouncedSearch.trim();
    if (normalized !== queryState.query) {
      updateLocation({ query: normalized });
    }
  }, [debouncedSearch, queryState.query, searchInput, updateLocation]);

  const client = useMemo(
    () =>
      ctx.currentUserAccessToken
        ? buildCmaClient({
            currentUserAccessToken: ctx.currentUserAccessToken,
            environment: ctx.environment,
            cmaBaseUrl: ctx.cmaBaseUrl,
          })
        : null,
    [ctx.cmaBaseUrl, ctx.currentUserAccessToken, ctx.environment],
  );
  const itemTypes = useMemo(() => rawItemTypes(ctx.itemTypes), [ctx.itemTypes]);
  const models = useMemo(() => getRegularModels(itemTypes), [itemTypes]);
  const modelsById = useMemo(() => modelMap(models), [models]);
  const modelFilterOptions = useMemo(
    () => [
      { label: 'All models', value: '' },
      ...models.map((model) => ({ label: model.name, value: model.id })),
    ],
    [models],
  );
  const schemaVersion = useMemo(
    () => models.map((model) => model.id).join(','),
    [models],
  );
  const ordering = useOrderingState({
    itemTypes,
    modelId: queryState.model,
    status: queryState.status,
    orderBy: queryState.orderBy,
    loadItemTypeFields: ctx.loadItemTypeFields,
    onUnsupportedPreviewOrder: clearUnsupportedPreviewOrder,
  });

  const selectionScope = `${ctx.site.id}:${ctx.environment}:${ctx.currentUser.type}:${ctx.currentUser.id}`;
  useLayoutEffect(() => {
    void selectionScope;
    actionController.current?.abort();
    actionController.current = null;
    actionLocked.current = false;
    setBusyAction(null);
    setCollectingSelection(false);
    setCollectionProgress(null);
    setBulkProgress(null);
    selectionFilterScope.current = null;
    setSelectedById(new Map());
    setShowingSelected(false);
    setSelectionPage(0);
    return () => {
      actionController.current?.abort();
      actionController.current = null;
    };
  }, [selectionScope]);

  useEffect(() => {
    setSelectedById((current) =>
      retainSelectionForModels(current, new Set(modelsById.keys())),
    );
  }, [modelsById]);

  useEffect(() => {
    if (queryState.model && !modelsById.has(queryState.model)) {
      updateLocation({ model: null });
    }
  }, [modelsById, queryState.model, updateLocation]);

  const itemsPage = useItemsPage({
    client,
    queryState,
    enabled:
      models.length > 0 && !ordering.pending && ordering.serverOrderBy !== null,
    refreshVersion,
    schemaVersion,
    serverOrderBy: ordering.serverOrderBy ?? undefined,
    models,
  });

  useEffect(() => {
    if (!itemsPage.loaded) {
      return;
    }

    const nextPage = clampPage(
      queryState.page,
      itemsPage.totalCount,
      queryState.perPage,
    );
    if (nextPage !== queryState.page) {
      updateLocation({ page: nextPage });
    }
  }, [
    itemsPage.loaded,
    itemsPage.totalCount,
    queryState.page,
    queryState.perPage,
    updateLocation,
  ]);

  const presentationResolver = useMemo(() => {
    // A record refresh must also reload cached references and upload previews.
    void refreshVersion;
    if (!client) {
      return null;
    }

    return createPresentationResolver({
      itemTypes,
      locales: ctx.site.attributes.locales,
      preferredLocale: undefined,
      timeZone: ctx.site.attributes.timezone,
      imgixHost: ctx.site.attributes.imgix_host ?? undefined,
      googleMapsApiToken:
        ctx.site.attributes.google_maps_api_token ?? undefined,
      loadFields: async (itemTypeIds): Promise<RawField[]> => {
        const fields = await mapBounded(itemTypeIds, (itemTypeId) =>
          ctx.loadItemTypeFields(itemTypeId),
        );
        return fields.flat() as RawField[];
      },
      loadItems: (ids) => loadItemsById(client, ids),
      loadUploads: (ids) => loadUploadsById(client, ids),
    });
  }, [
    client,
    ctx.loadItemTypeFields,
    ctx.site.attributes.google_maps_api_token,
    ctx.site.attributes.imgix_host,
    ctx.site.attributes.locales,
    ctx.site.attributes.timezone,
    itemTypes,
    refreshVersion,
  ]);

  const selectedItems = useMemo(
    () => [...selectedById.values()],
    [selectedById],
  );
  const selectedPage = useMemo(
    () =>
      selectedItems.slice(
        selectionPage * queryState.perPage,
        (selectionPage + 1) * queryState.perPage,
      ),
    [selectedItems, selectionPage, queryState.perPage],
  );
  const selectedItemsPage = useSelectedItemsPage(
    client,
    selectedPage,
    showingSelected,
    refreshVersion,
  );
  useEffect(() => {
    if (itemsPage.loaded) {
      setSelectedById((current) =>
        synchronizeSelection(current, itemsPage.items),
      );
    }
  }, [itemsPage.items, itemsPage.loaded]);
  useEffect(() => {
    if (!selectedItemsPage.loading && !selectedItemsPage.error) {
      setSelectedById((current) =>
        synchronizeSelection(current, selectedItemsPage.items),
      );
    }
  }, [
    selectedItemsPage.items,
    selectedItemsPage.loading,
    selectedItemsPage.error,
  ]);
  const displayItems = displayPage(
    showingSelected,
    selectedItemsPage.items,
    itemsPage.items,
  );
  const displayLoading = displayPage(
    showingSelected,
    selectedItemsPage.loading,
    itemsPage.loading,
  );
  const displayError = displayPage(
    showingSelected,
    selectedItemsPage.error,
    itemsPage.error,
  );
  useEffect(() => {
    setSelectionPage((page) =>
      clampPage(page, selectedItems.length, queryState.perPage),
    );
  }, [selectedItems.length, queryState.perPage]);
  const presentations = usePresentations(presentationResolver, displayItems);

  useEffect(() => {
    if (selectedItems.length === 0 && showingSelected) {
      setShowingSelected(false);
    }
  }, [selectedItems.length, showingSelected]);

  const tableRows = useMemo<TableRecord[]>(
    () =>
      displayItems.map((item) => {
        const presentation = presentations.byItemId.get(item.id);
        const model = modelsById.get(item.relationships.item_type.data.id);
        const status = presentation?.status ?? getItemStatus(item);
        const validity =
          presentation?.validity ??
          getItemValidity(item, model?.draftModeActive ?? false);

        return {
          id: item.id,
          title: presentation?.title ?? `Record #${item.id}`,
          imageUrl: presentation?.image?.url,
          imageAlt: '',
          model: model?.name ?? 'Unknown model',
          status,
          statusLabel: presentation?.statusLabel ?? ITEM_STATUS_LABEL[status],
          updatedAt: itemDate(
            item.meta.updated_at,
            ctx.ui.locale,
            ctx.site.attributes.timezone,
          ),
          createdAt: itemDate(
            item.meta.created_at,
            ctx.ui.locale,
            ctx.site.attributes.timezone,
          ),
          publishedValid: validity.publishedValid,
          currentValid: validity.currentValid,
          draftModeActive: model?.draftModeActive ?? false,
        };
      }),
    [
      ctx.site.attributes.timezone,
      ctx.ui.locale,
      displayItems,
      modelsById,
      presentations.byItemId,
    ],
  );

  const selectedIds = useMemo(
    () => new Set(selectedById.keys()),
    [selectedById],
  );
  const itemById = useMemo(
    () => new Map(displayItems.map((item) => [item.id, item])),
    [displayItems],
  );
  const storageKey = columnSettingsStorageKey({
    siteId: ctx.site.id,
    environment: ctx.environment,
    userId: ctx.currentUser.id,
  });
  const [columns, setColumns] = useColumnSettings(storageKey);
  const creatorRoles = useMemo(
    () => creatorRoleMap(ctx.users, ctx.ssoUsers, ctx.owner),
    [ctx.owner, ctx.ssoUsers, ctx.users],
  );
  const permissions = useMemo<PermissionContext>(
    () => ({
      role: ctx.currentRole,
      environment: ctx.environment,
      currentUser: {
        id: ctx.currentUser.id,
        type: ctx.currentUser.type,
      },
      creatorRoleByIdentity: creatorRoles,
    }),
    [
      creatorRoles,
      ctx.currentRole,
      ctx.currentUser.id,
      ctx.currentUser.type,
      ctx.environment,
    ],
  );
  const selectionInput = useMemo(
    () => ({ items: selectedItems, modelsById, permissions }),
    [modelsById, permissions, selectedItems],
  );
  const deleteEvaluation = useMemo(
    () => evaluateSelection({ ...selectionInput, action: 'delete' }),
    [selectionInput],
  );
  const publishEvaluation = useMemo(
    () => evaluateSelection({ ...selectionInput, action: 'publish' }),
    [selectionInput],
  );
  const unpublishEvaluation = useMemo(
    () => evaluateSelection({ ...selectionInput, action: 'unpublish' }),
    [selectionInput],
  );
  const moveContext = useMemo(
    () => getMoveSelectionContext(selectionInput),
    [selectionInput],
  );

  function clearSelection(): void {
    selectionFilterScope.current = null;
    setSelectedById(new Map());
    setShowingSelected(false);
    setSelectionPage(0);
  }

  function noteSelectionFilter(): void {
    if (selectedById.size === 0) {
      selectionFilterScope.current = matchingFilterScope;
    } else if (selectionFilterScope.current !== matchingFilterScope) {
      selectionFilterScope.current = null;
    }
  }

  function refresh(): void {
    setRefreshVersion((value) => value + 1);
  }

  function beginAction(action?: SelectionActionId): AbortController | null {
    if (actionLocked.current) return null;
    actionLocked.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    if (action) setBusyAction(action);
    return controller;
  }

  function finishAction(controller: AbortController): void {
    if (actionController.current !== controller) return;
    actionController.current = null;
    actionLocked.current = false;
    setBusyAction(null);
    setCollectingSelection(false);
    setCollectionProgress(null);
    setBulkProgress(null);
  }

  function isActive(controller: AbortController): boolean {
    return (
      actionController.current === controller && !controller.signal.aborted
    );
  }

  function reportActionError(
    controller: AbortController,
    message: string,
  ): void {
    if (actionController.current !== controller) return;
    ctx.alert(message);
    refresh();
  }

  function selectionLoadError(
    controller: AbortController,
    error: unknown,
  ): void {
    if (!isActive(controller)) return;
    reportActionError(
      controller,
      error instanceof Error
        ? error.message
        : 'Could not select matching records.',
    );
  }

  async function selectAllMatching(): Promise<void> {
    if (!client) return;
    const controller = beginAction();
    if (!controller) return;
    setCollectingSelection(true);
    setCollectionProgress('Selecting matching records…');
    try {
      const selection = await collectSelection(client, queryState, {
        signal: controller.signal,
        modelIds: models.map((model) => model.id),
        onProgress: (count, total) => {
          if (actionController.current === controller) {
            setCollectionProgress(`Selecting ${count} of ${total} records…`);
          }
        },
      });
      if (isActive(controller)) {
        selectionFilterScope.current = matchingFilterScope;
        setSelectedById(selection);
        setSelectionPage(0);
      }
    } catch (error) {
      selectionLoadError(controller, error);
    } finally {
      finishAction(controller);
    }
  }

  function operationProgress(controller: AbortController, count: number) {
    return count > MAX_BULK_ITEMS
      ? (progress: BulkOperationProgress) => {
          if (actionController.current === controller)
            setBulkProgress(progress);
        }
      : undefined;
  }

  async function selectionForAction(
    controller: AbortController,
  ): Promise<SelectionInput | null> {
    if (!client) return null;
    const items = await loadCurrentSelection(client, selectedItems, {
      signal: controller.signal,
    });
    if (!isActive(controller)) return null;
    setSelectedById(new Map(items.map((item) => [item.id, item])));
    return { items, modelsById, permissions };
  }

  async function applyBulkResult(
    controller: AbortController,
    currentSelection: SelectionInput,
    result: BulkOperationResult,
    submittedIds: readonly string[],
  ): Promise<void> {
    if (actionController.current !== controller) return;
    reportBulkResult(ctx, result);
    const retained = new Set(result.remainingItemIds);
    const submitted = new Set(submittedIds);
    const remaining = currentSelection.items.filter(
      (item) => !submitted.has(item.id) || retained.has(item.id),
    );
    selectionFilterScope.current = null;
    setSelectedById(new Map(remaining.map((item) => [item.id, item])));
    setShowingSelected(false);
    refresh();
    if (!client || remaining.length === 0) return;
    try {
      // A partially successful batch retains all its IDs; refresh their stages
      // and creator scopes before making the selection available again.
      const items = await loadCurrentSelection(client, remaining, {
        // A partial delete may have removed IDs that its count-only result
        // could not identify. The current read reconciles those missing IDs.
        omitMissing: result.operation === 'delete',
        signal: controller.signal,
      });
      if (actionController.current === controller) {
        setSelectedById(new Map(items.map((item) => [item.id, item])));
      }
    } catch (error) {
      if (!isActive(controller)) return;
      ctx.alert(
        `The action finished, but the remaining selection could not be refreshed: ${
          error instanceof Error ? error.message : 'The request failed.'
        }`,
      );
    }
  }

  async function runSelectionAction(
    action: BulkSelectionAction,
  ): Promise<void> {
    if (!client) {
      ctx.alert(
        'This action requires the current user access token permission.',
      );
      return;
    }
    const controller = beginAction(action);
    if (!controller) return;
    try {
      const currentSelection = await selectionForAction(controller);
      if (!currentSelection) return;
      const evaluation = evaluateSelection({ ...currentSelection, action });
      if (evaluation.disabledReason) {
        reportActionError(controller, evaluation.disabledReason);
        return;
      }
      const confirmed = await confirmSelectionAction(ctx, action, evaluation);
      if (!confirmed || controller.signal.aborted) return;
      setShowingSelected(false);
      const result = await executeBulkOperation(
        client,
        {
          operation: action,
          itemIds: evaluation.itemIds,
        },
        {
          signal: controller.signal,
          onProgress: operationProgress(controller, evaluation.itemIds.length),
        },
      );
      await applyBulkResult(
        controller,
        currentSelection,
        result,
        evaluation.itemIds,
      );
    } catch (error) {
      reportActionError(controller, bulkErrorMessage(action, error));
    } finally {
      finishAction(controller);
    }
  }

  async function runMoveToStage(): Promise<void> {
    if (!client) {
      ctx.alert(
        'This action requires the current user access token permission.',
      );
      return;
    }
    const controller = beginAction('move');
    if (!controller) return;
    try {
      const currentSelection = await selectionForAction(controller);
      if (!currentSelection) return;
      const currentMoveContext = getMoveSelectionContext(currentSelection);
      if (!currentMoveContext.enabled) {
        reportActionError(controller, currentMoveContext.disabledReason);
        return;
      }
      const request = await prepareMoveOperation({
        client,
        ctx,
        moveContext: currentMoveContext,
        selectionInput: currentSelection,
        signal: controller.signal,
      });
      if (!request || controller.signal.aborted) return;
      const result = await executeBulkOperation(client, request, {
        signal: controller.signal,
        onProgress: operationProgress(controller, request.itemIds.length),
      });
      await applyBulkResult(
        controller,
        currentSelection,
        result,
        request.itemIds,
      );
    } catch (error) {
      reportActionError(controller, bulkErrorMessage('move_to_stage', error));
    } finally {
      finishAction(controller);
    }
  }

  const tableDisabled =
    busyAction !== null || collectingSelection || ordering.pending;
  const totalLabel = recordsLabel(itemsPage.totalCount);
  const selectionActions = buildSelectionBarActions({
    deleteEvaluation,
    publishEvaluation,
    unpublishEvaluation,
    moveEnabled: moveContext.enabled,
    onDelete: () => runSelectionAction('delete'),
    onPublish: () => runSelectionAction('publish'),
    onUnpublish: () => runSelectionAction('unpublish'),
    onMove: runMoveToStage,
  });

  if (!ctx.currentUserAccessToken) {
    return (
      <Canvas ctx={ctx} noAutoResizer>
        <div className={styles.page}>
          <div className={styles.state}>
            <h2>API access required</h2>
            <p>
              Grant the Current user access token permission to this plugin,
              then reload the page.
            </p>
          </div>
        </div>
      </Canvas>
    );
  }

  if (models.length === 0) {
    return (
      <Canvas ctx={ctx} noAutoResizer>
        <div className={styles.page}>
          <div className={styles.state}>
            <h2>No record models</h2>
            <p>This environment does not contain any non-block models.</p>
          </div>
        </div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={styles.page}>
        <header className={styles.toolbar}>
          <h1 className={styles.title}>All Records</h1>
          <div className={styles.spacer} />
          <div className={styles.total}>{totalLabel}</div>
        </header>

        <div className={styles.filterBar}>
          <div className={styles.searchWrap}>
            <svg
              aria-hidden="true"
              viewBox="0 0 512 512"
              className={styles.searchIcon}
            >
              <path
                fill="currentColor"
                d="M416 208a208 208 0 1 1-416 0 208 208 0 0 1 416 0Zm-48 0a160 160 0 1 0-320 0 160 160 0 0 0 320 0Zm9.4 203.4 96 96a24 24 0 0 0 33.9-33.9l-96-96a24 24 0 0 0-33.9 33.9Z"
              />
            </svg>
            <input
              type="text"
              className={styles.search}
              aria-label="Search records"
              placeholder="Search records"
              value={searchInput}
              disabled={tableDisabled}
              onChange={(event) => {
                searchWasEdited.current = true;
                setSearchInput(event.target.value);
              }}
            />
            {searchInput && (
              <button
                type="button"
                className={styles.clearSearch}
                disabled={tableDisabled}
                aria-label="Clear search"
                onClick={() => {
                  searchWasEdited.current = false;
                  setSearchInput('');
                  updateLocation({ query: '' });
                }}
              >
                ×
              </button>
            )}
          </div>

          <FilterDropdown
            ariaLabel="Filter by model"
            value={queryState.model ?? ''}
            options={modelFilterOptions}
            disabled={tableDisabled}
            onChange={(value) => updateLocation({ model: value || null })}
          />

          <FilterDropdown
            ariaLabel="Filter by publication status"
            value={queryState.status ?? ''}
            options={STATUS_FILTER_OPTIONS}
            alignment="right"
            disabled={tableDisabled}
            onChange={(value) =>
              updateLocation({
                status: (value as QueryState['status']) || null,
              })
            }
          />
        </div>

        <main className={styles.content}>
          {displayError ? (
            <div className={styles.state}>
              <h2>Could not load records</h2>
              <p>{displayError}</p>
              <button type="button" className={styles.retry} onClick={refresh}>
                Retry
              </button>
            </div>
          ) : (
            <AllRecordsTable
              columns={columns}
              rows={tableRows}
              selectedIds={selectedIds}
              orderBy={displayedOrderBy(queryState)}
              sortableColumnIds={ordering.columnIds}
              onColumnsChange={setColumns}
              onOrderByChange={(orderBy) => updateLocation({ orderBy })}
              onToggleRow={(itemId) => {
                const item = itemById.get(itemId);
                if (!item) {
                  return;
                }
                noteSelectionFilter();
                setSelectedById((current) => {
                  const next = new Map(current);
                  if (next.has(itemId)) {
                    next.delete(itemId);
                  } else {
                    next.set(itemId, compactSelectedItem(item));
                  }
                  return next;
                });
              }}
              onTogglePage={(selected) => {
                noteSelectionFilter();
                setSelectedById((current) =>
                  setPageSelection(current, displayItems, selected),
                );
              }}
              onOpenRow={(row) => {
                const item = itemById.get(row.id);
                const modelId = item?.relationships.item_type.data.id;
                if (!item || !modelId) {
                  return;
                }
                void ctx.navigateTo(
                  buildRecordEditorUrl({
                    environment: ctx.environment,
                    isEnvironmentPrimary: ctx.isEnvironmentPrimary,
                    modelId,
                    itemId: item.id,
                  }),
                );
              }}
              loading={displayLoading || presentations.loading}
              disabled={tableDisabled || displayLoading}
              sortingDisabled={Boolean(queryState.query)}
              emptyState={emptyStateMessage(queryState)}
            />
          )}
        </main>

        <div className={styles.slideUpToolbar}>
          <SelectionActionBar
            selectedCount={selectedItems.length}
            showingSelected={showingSelected}
            onToggleShowingSelected={() => {
              setSelectionPage(0);
              setShowingSelected((current) => !current);
            }}
            onInvertSelection={() => {
              noteSelectionFilter();
              setSelectedById((current) =>
                invertPageSelection(current, displayItems),
              );
            }}
            onClearSelection={clearSelection}
            disabled={tableDisabled || displayLoading}
            busyAction={busyAction}
            {...selectionScaleProps({
              showingSelected,
              total: itemsPage.totalCount,
              perPage: queryState.perPage,
              selectedCount: selectedItems.length,
              selectionBelongsToCurrentFilter:
                selectionFilterScope.current === matchingFilterScope,
              selectAll: selectAllMatching,
              collectionProgress,
              bulkProgress,
              cancel: () => {
                actionController.current?.abort();
                setCollectionProgress((value) =>
                  value ? 'Cancelling…' : null,
                );
              },
            })}
            actions={selectionActions}
          />
        </div>

        <Pagination
          currentPage={displayPage(
            showingSelected,
            selectionPage,
            queryState.page,
          )}
          perPage={queryState.perPage}
          totalEntries={displayPage(
            showingSelected,
            selectedItems.length,
            itemsPage.totalCount,
          )}
          disabled={displayLoading || tableDisabled}
          onPageChange={(page) =>
            showingSelected ? setSelectionPage(page) : updateLocation({ page })
          }
          onPerPageChange={(perPage) => {
            setSelectionPage(0);
            updateLocation({ perPage });
          }}
        />
      </div>
    </Canvas>
  );
}
