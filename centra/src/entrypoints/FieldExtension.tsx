import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import get from 'lodash-es/get';
import isEqual from 'lodash-es/isEqual';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import SelectedReferenceRow from '../components/SelectedReferenceRow';
import { PICKER_MODAL_HEIGHT, PICKER_MODAL_ID } from '../constants';
import {
  CentraClient,
  type CentraDisplayItem,
  type CentraItem,
} from '../lib/centraClient';
import {
  isConnectionComplete,
  normalizeFieldParameters,
  resolveConnection,
} from '../lib/parameters';
import {
  buildReferenceDocument,
  moveReference,
  parseReferenceDocument,
  referenceKey,
} from '../lib/references';
import type {
  CentraFieldParametersV1,
  CentraReference,
  PickerModalResult,
} from '../types';
import styles from './FieldExtension.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type HydratedReference = Awaited<
  ReturnType<CentraClient['hydrateReferences']>
>[number];

type CachedHydratedReference = {
  key: string;
  entry: HydratedReference;
};

type HydrationState =
  | {
      status: 'idle' | 'loading';
      entries: CachedHydratedReference[];
      referenceKeys: string[];
    }
  | {
      status: 'success';
      entries: CachedHydratedReference[];
      referenceKeys: string[];
    }
  | {
      status: 'error';
      entries: CachedHydratedReference[];
      referenceKeys: string[];
      error: string;
    };

const DROP_ANIMATION: DropAnimation = {
  duration: 200,
  easing: 'cubic-bezier(0.55, 0, 0.1, 1)',
  keyframes: ({ transform: { initial, final } }) => [
    { transform: CSS.Transform.toString(initial), opacity: 1 },
    { transform: CSS.Transform.toString(final), opacity: 0 },
  ],
  sideEffects: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function useDeepStableValue<T>(value: T): T {
  const valueRef = useRef(value);

  if (!isEqual(valueRef.current, value)) {
    valueRef.current = value;
  }

  return valueRef.current;
}

function haveSameReferenceKeys(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right);
  return (
    rightKeys.size === right.length && left.every((key) => rightKeys.has(key))
  );
}

function arrangeReferences(
  kind: CentraFieldParametersV1['kind'],
  references: readonly CentraReference[],
  orderedKeys: readonly string[] | null,
): CentraReference[] | null {
  if (!orderedKeys || orderedKeys.length !== references.length) return null;

  const referencesByKey = new Map(
    references.map((reference) => [referenceKey(kind, reference), reference]),
  );
  if (referencesByKey.size !== references.length) return null;

  const orderedReferences: CentraReference[] = [];
  for (const key of orderedKeys) {
    const reference = referencesByKey.get(key);
    if (!reference) return null;
    orderedReferences.push(reference);
  }
  return orderedReferences;
}

function useStableReferenceMembership(
  kind: CentraFieldParametersV1['kind'],
  references: readonly CentraReference[],
): readonly CentraReference[] {
  const keys = references
    .map((reference) => referenceKey(kind, reference))
    .sort();
  const membershipRef = useRef({ kind, keys, references });

  if (
    membershipRef.current.kind !== kind ||
    !isEqual(membershipRef.current.keys, keys)
  ) {
    membershipRef.current = { kind, keys, references };
  }

  return membershipRef.current.references;
}

function validFieldParameters(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.paramsVersion === '1' &&
    (value.kind === 'primaryProduct' ||
      value.kind === 'variant' ||
      value.kind === 'item') &&
    (value.cardinality === 'single' || value.cardinality === 'multiple')
  );
}

function productTitle(displayItem: CentraDisplayItem): string {
  return (
    displayItem.name?.trim() ||
    displayItem.productVariant?.name?.trim() ||
    (displayItem.productNumber
      ? `Product ${displayItem.productNumber}`
      : `DisplayItem ${displayItem.id}`)
  );
}

function imageUrl(displayItem: CentraDisplayItem | undefined): string | null {
  const media = displayItem?.media;
  if (!media || media.length === 0) return null;
  const image = media.find((medium) =>
    medium.source.type?.toLocaleLowerCase().includes('image'),
  );
  return image?.source.url ?? media[0]?.source.url ?? null;
}

function itemTitle(item: CentraItem): string {
  return (
    item.name?.trim() ||
    (item.productSizeId !== undefined
      ? `Size ${String(item.productSizeId)}`
      : undefined) ||
    item.sku?.trim() ||
    `Item ${item.id}`
  );
}

function displayItemDetail(displayItem: CentraDisplayItem): string[] {
  return Array.from(
    new Set(
      [
        displayItem.productVariant?.name?.trim(),
        displayItem.productVariant?.number?.trim(),
        displayItem.price?.formattedValue,
      ].filter((part): part is string => Boolean(part)),
    ),
  );
}

function itemDetail(
  displayItem: CentraDisplayItem,
  item: CentraItem,
): string[] {
  const label = itemTitle(item);
  const details = [
    label === item.sku?.trim() ? null : label,
    displayItem.productVariant?.name?.trim(),
    item.sku ? `SKU ${item.sku}` : null,
    displayItem.price?.formattedValue,
  ];
  return Array.from(
    new Set(details.filter((part): part is string => Boolean(part))),
  );
}

function fallbackIdentity(reference: CentraReference): string {
  return 'itemId' in reference
    ? `Item ${reference.itemId} · DisplayItem ${reference.displayItemId}`
    : `DisplayItem ${reference.displayItemId}`;
}

function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Centra could not hydrate the saved references.';
}

function readPickerResult(value: unknown): PickerModalResult | null {
  if (!isRecord(value) || !Array.isArray(value.references)) {
    return null;
  }
  return { references: value.references as CentraReference[] };
}

function entityLabel(parameters: CentraFieldParametersV1): string {
  if (parameters.kind === 'item') return 'SKU';
  if (parameters.kind === 'variant') return 'product variant';
  return 'product';
}

function emptyLabel(parameters: CentraFieldParametersV1): string {
  if (parameters.cardinality === 'single') {
    if (parameters.kind === 'item') return 'No SKU specified';
    if (parameters.kind === 'variant') return 'No product variant specified';
    return 'No product specified';
  }

  if (parameters.kind === 'item') return 'No SKUs present';
  if (parameters.kind === 'variant') return 'No product variants present';
  return 'No products present';
}

function PlusIcon() {
  return (
    <svg className={styles.plusIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function SortableReferenceItem({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      className={`${styles.sortableItem} ${
        isDragging ? styles.sortableItemDragging : ''
      }`}
      style={style}
      data-testid="centra-sortable-reference"
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function ReferenceEntrySkeleton() {
  return (
    <article
      className={styles.skeletonCard}
      data-testid="centra-reference-skeleton"
      aria-label="Loading saved Centra reference"
    >
      <div className={styles.skeletonMedia} aria-hidden="true" />
      <div className={styles.skeletonCaption} aria-hidden="true">
        <span className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
        <span className={`${styles.skeletonLine} ${styles.skeletonDetail}`} />
      </div>
    </article>
  );
}

type ReferenceEntryProps = {
  reference: CentraReference;
  hydrated?: HydratedReference;
  kind: CentraFieldParametersV1['kind'];
  disabled: boolean;
  onReplace: () => void;
  onRemove: () => void;
};

function unresolvedReason(reason: 'displayItemNotFound' | 'itemNotFound') {
  return reason === 'itemNotFound'
    ? 'The saved SKU item could not be found. The IDs remain unchanged.'
    : 'The saved DisplayItem could not be found. The ID remains unchanged.';
}

function referenceDetails(
  displayItem: CentraDisplayItem | undefined,
  item: CentraItem | undefined,
): string[] {
  if (!displayItem) return [];
  return item ? itemDetail(displayItem, item) : displayItemDetail(displayItem);
}

function referenceWarning(
  hydrated: HydratedReference | undefined,
): string | undefined {
  if (hydrated?.status === 'resolved' && hydrated.primaryDrift) {
    return 'This DisplayItem is no longer the primary variant. The saved ID has not changed.';
  }
  if (hydrated?.status === 'unresolved') {
    return unresolvedReason(hydrated.reason);
  }
  return undefined;
}

function referenceStatus(
  displayItem: CentraDisplayItem | undefined,
  item: CentraItem | undefined,
): 'Unavailable' | 'Out of stock' | null {
  if (displayItem?.available === false) return 'Unavailable';
  if (item) {
    return item.stock?.available === false ? 'Out of stock' : null;
  }
  return displayItem?.hasStock === false ? 'Out of stock' : null;
}

function ReferenceEntry({
  reference,
  hydrated,
  kind,
  disabled,
  onReplace,
  onRemove,
}: ReferenceEntryProps) {
  const resolved = hydrated?.status === 'resolved' ? hydrated : undefined;
  const unresolved = hydrated?.status === 'unresolved' ? hydrated : undefined;
  const displayItem = resolved?.displayItem ?? unresolved?.displayItem;
  const item = resolved?.item;
  let title = kind === 'item' ? 'Centra SKU' : 'Centra product';

  if (displayItem) {
    title = productTitle(displayItem);
  }

  const details = referenceDetails(displayItem, item);
  const warning = referenceWarning(hydrated);
  const status = referenceStatus(displayItem, item);

  return (
    <SelectedReferenceRow
      title={title}
      identity={fallbackIdentity(reference)}
      detail={details.length > 0 ? details.join(' · ') : null}
      imageUrl={imageUrl(displayItem)}
      status={status}
      preorder={item?.preorder === true}
      unresolved={hydrated?.status === 'unresolved'}
      showIdentity={!displayItem}
      warning={warning}
      disabled={disabled}
      onReplace={onReplace}
      onRemove={onRemove}
    />
  );
}

export default function FieldExtension({ ctx }: Props) {
  const rawValue = get(ctx.formValues, ctx.fieldPath) as unknown;
  const stableRawValue = useDeepStableValue(rawValue);
  const stableFieldParameters = useDeepStableValue(ctx.parameters);
  const stablePluginParameters = useDeepStableValue(
    ctx.plugin.attributes.parameters,
  );
  const fieldParametersValid = validFieldParameters(stableFieldParameters);
  const fieldParameters = useMemo(
    () => normalizeFieldParameters(stableFieldParameters),
    [stableFieldParameters],
  );
  const parsed = useMemo(
    () => parseReferenceDocument(stableRawValue, stableFieldParameters),
    [stableFieldParameters, stableRawValue],
  );
  const connection = useMemo(
    () => resolveConnection(stablePluginParameters),
    [stablePluginParameters],
  );
  const client = useMemo(() => new CentraClient(connection), [connection]);
  const [hydration, setHydration] = useState<HydrationState>({
    status: 'idle',
    entries: [],
    referenceKeys: [],
  });
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null);
  const [optimisticReferenceKeys, setOptimisticReferenceKeys] = useState<
    string[] | null
  >(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const savedReferences = parsed.ok ? parsed.references : [];
  const savedReferenceKeys = useMemo(
    () =>
      savedReferences.map((reference) =>
        referenceKey(fieldParameters.kind, reference),
      ),
    [fieldParameters.kind, savedReferences],
  );
  const optimisticReferences = useMemo(
    () =>
      arrangeReferences(
        fieldParameters.kind,
        savedReferences,
        optimisticReferenceKeys,
      ),
    [fieldParameters.kind, optimisticReferenceKeys, savedReferences],
  );
  const references = optimisticReferences ?? savedReferences;
  const currentReferenceKeys = useMemo(
    () =>
      references.map((reference) =>
        referenceKey(fieldParameters.kind, reference),
      ),
    [fieldParameters.kind, references],
  );
  const hydrationReferences = useStableReferenceMembership(
    fieldParameters.kind,
    savedReferences,
  );
  const hydratedByKey = useMemo(
    () =>
      new Map(hydration.entries.map(({ key, entry }) => [key, entry] as const)),
    [hydration.entries],
  );
  const hydrationMatchesReferences = haveSameReferenceKeys(
    hydration.referenceKeys,
    currentReferenceKeys,
  );
  const sortingEnabled =
    fieldParameters.cardinality === 'multiple' &&
    references.length > 1 &&
    !ctx.disabled;
  const activeDragIndex = activeDragKey
    ? currentReferenceKeys.indexOf(activeDragKey)
    : -1;
  const activeDragReference = references[activeDragIndex];

  useEffect(() => {
    if (!optimisticReferenceKeys) return;
    if (
      isEqual(savedReferenceKeys, optimisticReferenceKeys) ||
      !optimisticReferences
    ) {
      setOptimisticReferenceKeys(null);
    }
  }, [optimisticReferenceKeys, optimisticReferences, savedReferenceKeys]);

  useEffect(() => {
    if (
      !fieldParametersValid ||
      !parsed.ok ||
      hydrationReferences.length === 0 ||
      !isConnectionComplete(connection)
    ) {
      setHydration({ status: 'idle', entries: [], referenceKeys: [] });
      return;
    }

    const controller = new AbortController();
    const requestedKeys = hydrationReferences.map((reference) =>
      referenceKey(fieldParameters.kind, reference),
    );
    setHydration((current) => ({
      status: 'loading',
      entries: current.entries,
      referenceKeys: requestedKeys,
    }));
    void client
      .hydrateReferences({
        references: hydrationReferences,
        kind: fieldParameters.kind,
        signal: controller.signal,
      })
      .then((entries) => {
        if (controller.signal.aborted) return;
        setHydration({
          status: 'success',
          entries: entries.map((entry) => ({
            key: referenceKey(fieldParameters.kind, entry.reference),
            entry,
          })),
          referenceKeys: requestedKeys,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHydration((current) => ({
          status: 'error',
          entries: current.entries,
          referenceKeys: requestedKeys,
          error: friendlyError(error),
        }));
      });

    return () => controller.abort();
  }, [
    client,
    connection,
    fieldParameters.kind,
    fieldParametersValid,
    hydrationReferences,
    parsed.ok,
  ]);

  const persist = async (nextReferences: readonly CentraReference[]) => {
    const document = buildReferenceDocument(fieldParameters, nextReferences);
    await ctx.setFieldValue(
      ctx.fieldPath,
      document === null ? null : JSON.stringify(document, null, 2),
    );
  };

  const openPicker = async (
    currentReferences: CentraReference[],
    parameters = fieldParameters,
  ): Promise<CentraReference[] | null> => {
    if (ctx.disabled) return null;

    const rawResult = await ctx.openModal({
      id: PICKER_MODAL_ID,
      title: `Select Centra ${entityLabel(parameters)}${
        parameters.cardinality === 'multiple' ? 's' : ''
      }`,
      width: 'xl',
      initialHeight: PICKER_MODAL_HEIGHT,
      parameters: {
        fieldParameters: parameters,
        references: currentReferences,
      },
    });
    return readPickerResult(rawResult)?.references ?? null;
  };

  const openAndPersist = async () => {
    const result = await openPicker(references);
    if (result) await persist(result);
  };

  const replaceAt = async (index: number) => {
    const current = references[index];
    if (!current) return;
    const singleParameters: CentraFieldParametersV1 = {
      ...fieldParameters,
      cardinality: 'single',
    };
    const result = await openPicker([current], singleParameters);
    const replacement = result?.[0];
    if (!replacement) return;
    const replacementKey = referenceKey(fieldParameters.kind, replacement);
    const alreadySelected = references.some(
      (reference, referenceIndex) =>
        referenceIndex !== index &&
        referenceKey(fieldParameters.kind, reference) === replacementKey,
    );
    if (alreadySelected) {
      await ctx.alert(
        'That Centra reference is already selected in this field.',
      );
      return;
    }
    const next = [...references];
    next[index] = replacement;
    await persist(next);
  };

  const clearInvalidValue = async () => {
    if (ctx.disabled) return;
    const confirmed = await ctx.openConfirm({
      title: 'Clear invalid Centra value?',
      content:
        'The existing raw JSON will be removed. This action cannot be undone from the plugin.',
      choices: [{ label: 'Clear value', value: 'clear', intent: 'negative' }],
      cancel: { label: 'Keep value', value: 'cancel' },
    });
    if (confirmed === 'clear') {
      await ctx.setFieldValue(ctx.fieldPath, null);
    }
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (!sortingEnabled) return;
    setActiveDragKey(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const draggedKey = String(active.id);
    setActiveDragKey(null);
    if (!sortingEnabled || !over || active.id === over.id) return;

    const sourceIndex = currentReferenceKeys.indexOf(draggedKey);
    const destinationIndex = currentReferenceKeys.indexOf(String(over.id));
    if (sourceIndex < 0 || destinationIndex < 0) return;

    const nextReferences = moveReference(
      references,
      sourceIndex,
      destinationIndex,
    );
    const nextReferenceKeys = nextReferences.map((reference) =>
      referenceKey(fieldParameters.kind, reference),
    );
    setOptimisticReferenceKeys(nextReferenceKeys);
    void persist(nextReferences).catch(() => {
      setOptimisticReferenceKeys((current) =>
        isEqual(current, nextReferenceKeys) ? null : current,
      );
      void ctx.alert('The new Centra order could not be saved. Try again.');
    });
  };

  if (ctx.field.attributes.field_type !== 'json') {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error} role="alert">
          The Centra reference editor supports JSON fields only.
        </div>
      </Canvas>
    );
  }

  if (!fieldParametersValid) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error} role="alert">
          This field has unsupported Centra settings. Open the field settings,
          choose a reference type and selection mode, then save the schema.
        </div>
      </Canvas>
    );
  }

  if (!parsed.ok) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.root}>
          <div className={styles.error} role="alert">
            <strong>Saved value preserved.</strong> {parsed.error.message}
          </div>
          <div>
            <Button
              buttonType="negative"
              buttonSize="s"
              disabled={ctx.disabled}
              onClick={() => void clearInvalidValue()}
            >
              Clear invalid value
            </Button>
          </div>
        </div>
      </Canvas>
    );
  }

  if (!isConnectionComplete(connection)) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error} role="alert">
          Add a valid Centra Storefront API URL and token in the plugin settings
          to use this field.
        </div>
      </Canvas>
    );
  }

  const label = entityLabel(fieldParameters);

  return (
    <Canvas ctx={ctx}>
      <div className={styles.root}>
        {hydration.status === 'error' && (
          <div className={styles.warning} role="alert">
            Live catalog details could not be loaded. Saved IDs remain
            unchanged. {hydration.error}
          </div>
        )}

        {references.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyLabel}>
              {emptyLabel(fieldParameters)}
            </div>
            <div className={styles.emptyActions}>
              <Button
                buttonSize="s"
                buttonType="muted"
                leftIcon={<PlusIcon />}
                disabled={ctx.disabled}
                onClick={() => void openAndPersist()}
              >
                Choose {label}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragCancel={() => setActiveDragKey(null)}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={currentReferenceKeys}
                strategy={rectSortingStrategy}
              >
                <div
                  className={`${styles.list} ${
                    fieldParameters.cardinality === 'single'
                      ? styles.single
                      : ''
                  }`}
                  aria-busy={hydration.status === 'loading'}
                >
                  {references.map((reference, index) => {
                    const key = referenceKey(fieldParameters.kind, reference);
                    const hydrated = hydratedByKey.get(key);
                    const showSkeleton =
                      !hydrated &&
                      (hydration.status === 'idle' ||
                        hydration.status === 'loading' ||
                        !hydrationMatchesReferences);

                    const entry = showSkeleton ? (
                      <ReferenceEntrySkeleton key={`${key}:skeleton`} />
                    ) : (
                      <ReferenceEntry
                        key={`${key}:entry`}
                        reference={reference}
                        hydrated={hydrated}
                        kind={fieldParameters.kind}
                        disabled={ctx.disabled}
                        onReplace={() => void replaceAt(index)}
                        onRemove={() =>
                          void persist(
                            references.filter(
                              (_candidate, candidateIndex) =>
                                candidateIndex !== index,
                            ),
                          )
                        }
                      />
                    );

                    return sortingEnabled ? (
                      <SortableReferenceItem key={key} id={key}>
                        {entry}
                      </SortableReferenceItem>
                    ) : (
                      <div key={key} className={styles.referenceItem}>
                        {entry}
                      </div>
                    );
                  })}
                </div>
              </SortableContext>

              <DragOverlay dropAnimation={DROP_ANIMATION}>
                {activeDragReference && (
                  <div className={styles.dragOverlay}>
                    <ReferenceEntry
                      reference={activeDragReference}
                      hydrated={hydratedByKey.get(
                        referenceKey(fieldParameters.kind, activeDragReference),
                      )}
                      kind={fieldParameters.kind}
                      disabled
                      onReplace={() => undefined}
                      onRemove={() => undefined}
                    />
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {fieldParameters.cardinality === 'multiple' && (
              <div className={styles.addAction}>
                <Button
                  buttonSize="s"
                  buttonType="muted"
                  leftIcon={<PlusIcon />}
                  disabled={ctx.disabled}
                  onClick={() => void openAndPersist()}
                >
                  Add {label}s
                </Button>
              </div>
            )}
          </>
        )}

        {ctx.disabled && (
          <div className={styles.disabledHint}>
            This field is read-only in the current workflow state.
          </div>
        )}
      </div>
    </Canvas>
  );
}
