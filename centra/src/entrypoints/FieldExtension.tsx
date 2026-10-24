import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import CardList from 'datocms-react-ui/CardList';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import {
  DragHandle,
  SortableItem,
  type SortableItemApi,
  SortableList,
} from 'datocms-react-ui/dnd';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import EntityRow from 'datocms-react-ui/EntityRow';
import FieldHint from 'datocms-react-ui/FieldHint';
import Link from 'datocms-react-ui/Link';
import Pill from 'datocms-react-ui/Pill';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import get from 'lodash-es/get';
import isEqual from 'lodash-es/isEqual';
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Thumbnail from '../components/Thumbnail';
import { PICKER_MODAL_HEIGHT, PICKER_MODAL_ID } from '../constants';
import {
  ArrowDownIcon,
  ArrowRightArrowLeftIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  TrashIcon,
} from '../icons';
import {
  CentraClient,
  type HydratedCentraReference,
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
import {
  type CountNouns,
  displayItemDetail,
  fallbackIdentity,
  imageUrl,
  isRecord,
  itemDetail,
  KIND_NOUNS,
  productTitle,
  referenceStatus,
} from '../utils/catalog';
import { pluginSettingsPath } from '../utils/paths';
import { useDeepStableValue } from '../utils/useDeepStableValue';
import styles from './FieldExtension.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type CachedHydratedReference = {
  key: string;
  entry: HydratedCentraReference;
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

/** A saved reference, with its catalog data once hydrated */
type ReferenceRow = {
  key: string;
  reference: CentraReference;
  hydrated: HydratedCentraReference | undefined;
  /** No catalog data yet: a reference added after the first load */
  loading: boolean;
};

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

function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Couldn't load the saved items from Centra.";
}

function readPickerResult(value: unknown): PickerModalResult | null {
  if (!isRecord(value) || !Array.isArray(value.references)) {
    return null;
  }
  return { references: value.references as CentraReference[] };
}

function referenceWarning(
  hydrated: HydratedCentraReference | undefined,
): { title: string; text: string } | undefined {
  if (hydrated?.status === 'resolved' && hydrated.primaryDrift) {
    return {
      title: 'No longer the primary variant',
      text: 'The saved ID is unchanged.',
    };
  }
  if (hydrated?.status === 'unresolved') {
    return hydrated.reason === 'itemNotFound'
      ? {
          title: 'Centra no longer has this SKU',
          text: 'The saved IDs are unchanged.',
        }
      : {
          title: 'Centra no longer has this product',
          text: 'The saved ID is unchanged.',
        };
  }
  return undefined;
}

/**
 * The title and the details line of a row. Without catalog data the title
 * is the saved IDs; an unresolved row adds them to its details.
 */
function rowText({ reference, hydrated, loading }: ReferenceRow) {
  if (loading) return { title: 'Loading…', details: '' };
  const displayItem = hydrated?.displayItem;
  if (!displayItem) return { title: fallbackIdentity(reference), details: '' };

  const item = hydrated?.status === 'resolved' ? hydrated.item : undefined;
  const details = item
    ? itemDetail(displayItem, item)
    : displayItemDetail(displayItem);
  if (hydrated?.status === 'unresolved') {
    details.push(fallbackIdentity(reference));
  }
  return { title: productTitle(displayItem), details: details.join(' · ') };
}

/** The open row menu that the frame keeps room for (one is open at a time) */
let roomHolder: HTMLElement | null = null;

/**
 * The field's frame is only as tall as its rows, and the kit fits an open
 * menu inside the frame, so in a short field a row's menu would scroll in a
 * sliver. While a menu is open, the frame keeps room for all of it under its
 * trigger (4px away, plus the 30px the kit keeps from the edge): the
 * auto-resizer grows the frame, and shrinks it back once the menu closes.
 * The kit fills the menu's portal right after setting its ref.
 */
function useMenuRoom(anchor: RefObject<HTMLElement | null>) {
  const openMenu = useRef<HTMLElement | null>(null);

  return useCallback(
    (menu: HTMLDivElement | null) => {
      const root = document.documentElement;
      if (openMenu.current && roomHolder === openMenu.current) {
        roomHolder = null;
        root.style.minHeight = '';
      }
      openMenu.current = menu;
      if (!menu) return;

      queueMicrotask(() => {
        if (!anchor.current || !menu.isConnected) return;
        const panel = menu.querySelector('[role="menu"]') ?? menu;
        const bottom = anchor.current.getBoundingClientRect().bottom;
        roomHolder = menu;
        root.style.minHeight = `${Math.ceil(
          bottom + window.scrollY + 4 + panel.scrollHeight + 30,
        )}px`;
      });
    },
    [anchor],
  );
}

type RowMenuProps = {
  title: string;
  /** A multiple field with several items: Move up and Move down */
  reorderable: boolean;
  index: number;
  count: number;
  onReplace: () => void;
  onRemove: () => void;
  onMove: (to: number) => void;
};

/** The "⋮" of a row. Move up and Move down are the keyboard's reorder. */
function RowMenu({
  title,
  reorderable,
  index,
  count,
  onReplace,
  onRemove,
  onMove,
}: RowMenuProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const menuRef = useMenuRoom(anchor);

  return (
    <div ref={anchor}>
      <Dropdown
        triggerComponent={IconTrigger}
        icon={EllipsisVerticalIcon}
        label={`Actions for ${title}`}
      >
        <Dropdown.Menu ref={menuRef} placement="bottom-end">
          <Dropdown.Option
            icon={<ArrowRightArrowLeftIcon />}
            onPick={onReplace}
          >
            Replace
          </Dropdown.Option>
          {reorderable && index > 0 && (
            <Dropdown.Option
              icon={<ArrowUpIcon />}
              onPick={() => onMove(index - 1)}
            >
              Move up
            </Dropdown.Option>
          )}
          {reorderable && index < count - 1 && (
            <Dropdown.Option
              icon={<ArrowDownIcon />}
              onPick={() => onMove(index + 1)}
            >
              Move down
            </Dropdown.Option>
          )}
          <Dropdown.Separator />
          <Dropdown.Option icon={<TrashIcon />} alert onPick={onRemove}>
            Remove
          </Dropdown.Option>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}

type ReferenceItemProps = Omit<RowMenuProps, 'title'> & {
  row: ReferenceRow;
  /** What the field picks, singular ("product") */
  noun: string;
  sortable: SortableItemApi;
  /** A read-only field has no actions */
  disabled: boolean;
};

/**
 * One saved reference: its image, title, statuses and details, then the "⋮"
 * with its changes. A warning about the saved IDs shows under the row.
 */
function ReferenceItem({
  row,
  noun,
  sortable,
  disabled,
  ...menu
}: ReferenceItemProps) {
  const { hydrated, loading } = row;
  const displayItem = hydrated?.displayItem;
  const item = hydrated?.status === 'resolved' ? hydrated.item : undefined;
  const status = referenceStatus(displayItem, item);
  const warning = referenceWarning(hydrated);
  const { title, details } = rowText(row);

  return (
    <CardList.Item
      ref={sortable.ref}
      className={styles.item}
      row={{
        summary: (
          <>
            {menu.reorderable && (
              <DragHandle ref={sortable.handleRef} gutter="normal" />
            )}
            <EntityRow
              layout="row"
              image={<Thumbnail url={imageUrl(displayItem)} />}
              title={title}
              afterTitle={
                <>
                  {hydrated?.status === 'unresolved' && (
                    <Pill tone="warning">Not found</Pill>
                  )}
                  {status && <Pill tone="warning">{status}</Pill>}
                  {item?.preorder && <Pill>Preorder</Pill>}
                </>
              }
            >
              {details}
            </EntityRow>
            {loading && (
              <ProgressBar placement="edge" ariaLabel={`Loading the ${noun}`} />
            )}
            {/* The row is positioned: without a body, the drop line goes on
                its edges */}
            {!warning && sortable.dropIndicator}
          </>
        ),
        actions: !disabled && !loading && <RowMenu title={title} {...menu} />,
      }}
      body={
        warning ? (
          <>
            {sortable.dropIndicator}
            <Callout tone="warning" title={warning.title}>
              {warning.text}
            </Callout>
          </>
        ) : undefined
      }
    />
  );
}

type ReferenceListProps = {
  rows: ReferenceRow[];
  nouns: CountNouns;
  multiple: boolean;
  /** A multiple field with several items: drag and drop, Move up, Move down */
  reorderable: boolean;
  disabled: boolean;
  /** A hydration runs */
  busy: boolean;
  onAdd: () => void;
  onReplace: (index: number) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
};

/**
 * The references in one card, or the empty slot that fills the field. A
 * multiple field adds more from the card's footer.
 */
function ReferenceList({
  rows,
  nouns,
  multiple,
  reorderable,
  disabled,
  busy,
  onAdd,
  onReplace,
  onRemove,
  onReorder,
}: ReferenceListProps) {
  const add = {
    label: multiple ? `Add ${nouns.other}` : `Choose ${nouns.one}`,
    icon: PlusIcon,
    onClick: onAdd,
  };

  return (
    <div className={reorderable ? styles.gutter : undefined} aria-busy={busy}>
      {/* Always rendered, so the rows don't remount when reordering starts
          to apply: the list is only disabled */}
      <SortableList
        disabled={!reorderable}
        onDrop={({ source, destination }) =>
          onReorder(source.index, destination.index)
        }
      >
        <CardList
          add={multiple && !disabled ? add : undefined}
          empty={
            <EmptySlot
              message={`No ${multiple ? nouns.other : nouns.one} yet`}
              action={disabled ? undefined : add}
            />
          }
        >
          {rows.map((row, index) => (
            <SortableItem key={row.key} id={row.key} index={index} handle>
              {(sortable) => (
                <ReferenceItem
                  row={row}
                  noun={nouns.one}
                  sortable={sortable}
                  disabled={disabled}
                  reorderable={reorderable}
                  index={index}
                  count={rows.length}
                  onReplace={() => onReplace(index)}
                  onRemove={() => onRemove(index)}
                  onMove={(to) => onReorder(index, to)}
                />
              )}
            </SortableItem>
          ))}
        </CardList>
      </SortableList>
    </div>
  );
}

/** A saved value that the editor can't read, kept until an editor clears it */
function InvalidValue({
  message,
  disabled,
  onClear,
}: {
  message: string;
  disabled: boolean;
  onClear: () => Promise<void>;
}) {
  return (
    <>
      <Callout tone="danger" title="The saved value isn't valid">
        {message}
      </Callout>
      {!disabled && (
        <Button tone="ghost-alert" label="Clear value" onClick={onClear} />
      )}
    </>
  );
}

/** The connection is missing: the next step is the plugin settings */
function NotConnected({ ctx }: Props) {
  const settings = ctx.currentRole.meta.final_permissions.can_edit_schema ? (
    <Link
      to={pluginSettingsPath({
        pluginId: ctx.plugin.id,
        environment: ctx.environment,
        isEnvironmentPrimary: ctx.isEnvironmentPrimary,
      })}
    >
      plugin settings
    </Link>
  ) : (
    'plugin settings'
  );

  return (
    <Callout tone="warning" title="Centra isn't connected">
      Add the Storefront API URL and token in the {settings}.
    </Callout>
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
  // Until a hydration finishes or fails once, the field shows one loading
  // state, never the bare IDs; after it, a new reference loads in its row
  const [hydrationSettled, setHydrationSettled] = useState(false);
  const [optimisticReferenceKeys, setOptimisticReferenceKeys] = useState<
    string[] | null
  >(null);

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
        setHydrationSettled(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHydration((current) => ({
          status: 'error',
          entries: current.entries,
          referenceKeys: requestedKeys,
          error: friendlyError(error),
        }));
        setHydrationSettled(true);
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

  const nouns = KIND_NOUNS[fieldParameters.kind];

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

    const pickerNouns = KIND_NOUNS[parameters.kind];
    const rawResult = await ctx.openModal({
      id: PICKER_MODAL_ID,
      title: `Select Centra ${
        parameters.cardinality === 'multiple'
          ? pickerNouns.other
          : pickerNouns.one
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
      await ctx.alert(`That ${nouns.one} is already in this field.`);
      return;
    }
    const next = [...references];
    next[index] = replacement;
    await persist(next);
  };

  const clearInvalidValue = async () => {
    if (ctx.disabled) return;
    const confirmed = await ctx.openConfirm({
      title: 'Clear the saved value?',
      content:
        "The raw JSON of this field is removed. You can't undo this from the plugin.",
      choices: [{ label: 'Clear value', value: 'clear', intent: 'negative' }],
      cancel: { label: 'Keep value', value: 'cancel' },
    });
    if (confirmed === 'clear') {
      await ctx.setFieldValue(ctx.fieldPath, null);
    }
  };

  // A drop, Move up and Move down: the new order shows at once, then saves
  const reorder = (from: number, to: number) => {
    if (!sortingEnabled) return;
    const nextReferences = moveReference(references, from, to);
    const nextReferenceKeys = nextReferences.map((reference) =>
      referenceKey(fieldParameters.kind, reference),
    );
    setOptimisticReferenceKeys(nextReferenceKeys);
    void persist(nextReferences).catch(() => {
      setOptimisticReferenceKeys((current) =>
        isEqual(current, nextReferenceKeys) ? null : current,
      );
      void ctx.alert("Couldn't save the new order. Try again.");
    });
  };

  const rows = references.map((reference): ReferenceRow => {
    const key = referenceKey(fieldParameters.kind, reference);
    const hydrated = hydratedByKey.get(key);
    const loading =
      !hydrated &&
      (hydration.status === 'idle' ||
        hydration.status === 'loading' ||
        !hydrationMatchesReferences);
    return { key, reference, hydrated, loading };
  });

  if (ctx.field.attributes.field_type !== 'json') {
    return (
      <Canvas ctx={ctx}>
        <Callout tone="warning">
          The Centra editor works on JSON fields only.
        </Callout>
      </Canvas>
    );
  }

  if (!fieldParametersValid) {
    return (
      <Canvas ctx={ctx}>
        <Callout tone="warning" title="Unsupported field settings">
          Open the field settings, choose what editors pick and how many, then
          save the field.
        </Callout>
      </Canvas>
    );
  }

  if (!parsed.ok) {
    return (
      <Canvas ctx={ctx}>
        <InvalidValue
          message={parsed.error.message}
          disabled={ctx.disabled}
          onClear={clearInvalidValue}
        />
      </Canvas>
    );
  }

  if (!isConnectionComplete(connection)) {
    return (
      <Canvas ctx={ctx}>
        <NotConnected ctx={ctx} />
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      {hydration.status === 'error' && (
        <Callout tone="warning" title="Couldn't load the Centra details">
          The saved IDs are unchanged. {hydration.error}
        </Callout>
      )}

      {rows.length > 0 && !hydrationSettled ? (
        <BlankSlate
          placement="inline"
          small
          loading
          title={`Loading the ${nouns.other}`}
        />
      ) : (
        <ReferenceList
          rows={rows}
          nouns={nouns}
          multiple={fieldParameters.cardinality === 'multiple'}
          reorderable={sortingEnabled}
          disabled={ctx.disabled}
          busy={hydration.status === 'loading'}
          onAdd={() => void openAndPersist()}
          onReplace={(index) => void replaceAt(index)}
          onRemove={(index) =>
            void persist(
              references.filter(
                (_candidate, candidateIndex) => candidateIndex !== index,
              ),
            )
          }
          onReorder={reorder}
        />
      )}

      {ctx.disabled && <FieldHint hint="This field is read-only." />}
    </Canvas>
  );
}
