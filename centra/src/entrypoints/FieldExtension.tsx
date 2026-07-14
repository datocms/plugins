import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import get from 'lodash-es/get';
import isEqual from 'lodash-es/isEqual';
import { useEffect, useMemo, useRef, useState } from 'react';
import SelectedReferenceRow from '../components/SelectedReferenceRow';
import { PICKER_MODAL_ID } from '../constants';
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

type HydrationState =
  | { status: 'idle' | 'loading'; entries: HydratedReference[] }
  | { status: 'success'; entries: HydratedReference[] }
  | { status: 'error'; entries: HydratedReference[]; error: string };

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
  return [
    displayItem.productVariant?.name?.trim(),
    displayItem.productVariant?.number?.trim(),
    displayItem.price?.formattedValue,
  ].filter((part): part is string => Boolean(part));
}

function itemDetail(item: CentraItem): string[] {
  const details = [
    item.sku ? `SKU ${item.sku}` : null,
    item.GTIN ? `GTIN ${item.GTIN}` : null,
    item.stock ? (item.stock.available ? 'Available' : 'Unavailable') : null,
    item.preorder ? 'Preorder' : null,
  ];
  return details.filter((part): part is string => Boolean(part));
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

type ReferenceEntryProps = {
  reference: CentraReference;
  hydrated?: HydratedReference;
  kind: CentraFieldParametersV1['kind'];
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onReplace: () => void;
  onRemove: () => void;
};

function unresolvedReason(reason: 'displayItemNotFound' | 'itemNotFound') {
  return reason === 'itemNotFound'
    ? 'The saved SKU item could not be found. The IDs remain unchanged.'
    : 'The saved DisplayItem could not be found. The ID remains unchanged.';
}

function ReferenceEntry({
  reference,
  hydrated,
  kind,
  disabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onReplace,
  onRemove,
}: ReferenceEntryProps) {
  const resolved = hydrated?.status === 'resolved' ? hydrated : undefined;
  const unresolved = hydrated?.status === 'unresolved' ? hydrated : undefined;
  const displayItem = resolved?.displayItem ?? unresolved?.displayItem;
  const item = resolved?.item;
  let title =
    kind === 'item' ? 'Unresolved Centra SKU' : 'Unresolved Centra product';

  if (displayItem) {
    title = productTitle(displayItem);
  }
  if (item && resolved) {
    title = `${itemTitle(item)} — ${productTitle(resolved.displayItem)}`;
  }

  const details = [
    ...(displayItem ? displayItemDetail(displayItem) : []),
    ...(item ? itemDetail(item) : []),
  ];
  const warning = resolved?.primaryDrift
    ? 'This DisplayItem is no longer the primary variant. The saved ID has not changed.'
    : unresolved
      ? unresolvedReason(unresolved.reason)
      : undefined;

  return (
    <SelectedReferenceRow
      title={title}
      identity={fallbackIdentity(reference)}
      detail={details.length > 0 ? details.join(' · ') : null}
      imageUrl={imageUrl(displayItem)}
      unavailable={
        displayItem?.available === false || item?.stock?.available === false
      }
      unresolved={!hydrated || hydrated.status === 'unresolved'}
      warning={warning}
      disabled={disabled}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
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
  });

  const references = parsed.ok ? parsed.references : [];

  useEffect(() => {
    if (
      !fieldParametersValid ||
      !parsed.ok ||
      parsed.references.length === 0 ||
      !isConnectionComplete(connection)
    ) {
      setHydration({ status: 'idle', entries: [] });
      return;
    }

    const controller = new AbortController();
    setHydration({ status: 'loading', entries: [] });
    void client
      .hydrateReferences({
        references: parsed.references,
        kind: fieldParameters.kind,
        signal: controller.signal,
      })
      .then((entries) => {
        if (controller.signal.aborted) return;
        setHydration({ status: 'success', entries });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHydration({
          status: 'error',
          entries: [],
          error: friendlyError(error),
        });
      });

    return () => controller.abort();
  }, [
    client,
    connection,
    fieldParameters,
    fieldParametersValid,
    parsed,
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
      initialHeight: 650,
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
        <div className={styles.header}>
          <div className={styles.headerText}>
            <strong>
              Centra {label}
              {fieldParameters.cardinality === 'multiple' ? 's' : ''}
            </strong>
            <span>Catalog details are loaded live from Centra.</span>
          </div>
          {references.length > 0 &&
            fieldParameters.cardinality === 'multiple' && (
              <Button
                buttonSize="s"
                disabled={ctx.disabled}
                onClick={() => void openAndPersist()}
              >
                Add or edit
              </Button>
            )}
        </div>

        {ctx.disabled && (
          <div className={styles.disabledHint}>
            This field is read-only in the current workflow state.
          </div>
        )}

        {hydration.status === 'error' && (
          <div className={styles.warning} role="alert">
            Live catalog details could not be loaded. Saved IDs remain
            unchanged. {hydration.error}
          </div>
        )}

        {references.length === 0 ? (
          <div className={styles.empty}>
            <span>No Centra {label} selected.</span>
            <Button
              buttonSize="s"
              disabled={ctx.disabled}
              onClick={() => void openAndPersist()}
            >
              Select {label}
            </Button>
          </div>
        ) : (
          <div className={styles.list}>
            {references.map((reference, index) => (
              <ReferenceEntry
                key={fallbackIdentity(reference)}
                reference={reference}
                hydrated={hydration.entries[index]}
                kind={fieldParameters.kind}
                disabled={ctx.disabled}
                canMoveUp={index > 0}
                canMoveDown={index < references.length - 1}
                onMoveUp={
                  fieldParameters.cardinality === 'multiple'
                    ? () =>
                        void persist(
                          moveReference(references, index, index - 1),
                        )
                    : undefined
                }
                onMoveDown={
                  fieldParameters.cardinality === 'multiple'
                    ? () =>
                        void persist(
                          moveReference(references, index, index + 1),
                        )
                    : undefined
                }
                onReplace={() => void replaceAt(index)}
                onRemove={() =>
                  void persist(
                    references.filter(
                      (_candidate, candidateIndex) => candidateIndex !== index,
                    ),
                  )
                }
              />
            ))}
          </div>
        )}

        {hydration.status === 'loading' && (
          <div className={styles.loading} aria-label="Loading Centra details">
            <Spinner placement="centered" size={30} />
          </div>
        )}
      </div>
    </Canvas>
  );
}
