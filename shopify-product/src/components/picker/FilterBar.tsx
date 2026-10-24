import Button from 'datocms-react-ui/Button';
import { Dropdown, useCloseMenu } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import PillTrigger from 'datocms-react-ui/Dropdown/triggers/PillTrigger';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Pill from 'datocms-react-ui/Pill';
import StringInput from 'datocms-react-ui/StringInput';
import Toolbar from 'datocms-react-ui/Toolbar';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useState,
} from 'react';
import {
  type CollectionControls,
  type PickerFilters,
  tagsLabel,
} from '../../lib/pickerSearch';
import {
  type CollectionFilterSupport,
  isSortAvailable,
  PICKER_SORT_OPTIONS,
  type PickerSort,
  type SortContext,
} from '../../lib/queryString';
import type { CollectionSummary, FieldScope } from '../../types';
import type { AsyncValue } from '../shared/useAsyncValue';
import styles from './PickerBars.module.css';
import type { PagedQuery } from './usePagedQuery';
import { useTriggerFocus } from './useTriggerFocus';

type SetFilters = (update: (current: PickerFilters) => PickerFilters) => void;

/** Why a locked filter can't change. */
const LOCKED_HINT = 'Set in the field settings.';

const TAGS_UNSUPPORTED_HINT =
  "Set in the field settings. Shopify can't apply it inside this collection until the tag filter is enabled in Search & Discovery.";

/** Why a filter the editor set isn't applied inside the browsed collection. */
const NOT_APPLIED_HINT =
  'Not applied inside this collection. Enable this filter in Shopify Search & Discovery to use it inside a collection.';

/** The availability filter, named as in the field settings (`availableForSale`). */
const AVAILABLE_LABEL = 'Available for sale';

const VENDOR_INPUT_ID = 'shopify-picker-vendor';

/** `"Accessory"`, `"Accessory or Premium"`, `"Accessory +2"`. */
function shortTagsLabel(tags: readonly string[]): string {
  return tags.length <= 2 ? tagsLabel(tags) : `${tags[0]} +${tags.length - 1}`;
}

// ---------------------------------------------------------------------------
// Static pills
// ---------------------------------------------------------------------------

/**
 * A filter the field settings fixed: visible and explained, not editable. A
 * static pill, without the chevron of the filter menus next to it, and no
 * icon (a pill's icon only repeats what its text says). The tooltip says
 * where it's set, and never repeats the pill: only a value the pill
 * shortens ("Tags: Accessory +2") leads it in full.
 */
function LockedPill({
  text,
  fullValue,
  hint = LOCKED_HINT,
}: {
  text: string;
  /** The whole value, when `text` shortens it. */
  fullValue?: string;
  hint?: string;
}) {
  return (
    <Pill tooltip={fullValue ? `${fullValue}. ${hint}` : hint}>{text}</Pill>
  );
}

/**
 * A filter the editor set that the browsed collection can't apply: kept
 * (Clear filters and leaving the collection still make sense), not applied.
 * The results say so in a callout (`notAppliedNotice`); the tooltip only
 * repeats it on the pill.
 */
function NotAppliedPill({ text }: { text: string }) {
  return (
    <Pill tone="warning" tooltip={NOT_APPLIED_HINT}>
      {text}
    </Pill>
  );
}

function ScopePills({
  scope,
  collectionTitle,
  tagsUnsupported,
}: {
  scope: FieldScope;
  collectionTitle: string | null;
  tagsUnsupported: boolean;
}) {
  const tags = scope.tags ?? [];
  return (
    <>
      {scope.collectionId && (
        <LockedPill text={`Collection: ${collectionTitle ?? 'Loading…'}`} />
      )}
      {scope.productType && (
        <LockedPill text={`Product type: ${scope.productType}`} />
      )}
      {scope.vendor && <LockedPill text={`Vendor: ${scope.vendor}`} />}
      {tags.length > 0 && (
        <LockedPill
          text={`Tags: ${shortTagsLabel(tags)}`}
          fullValue={tags.length > 2 ? tagsLabel(tags) : undefined}
          hint={tagsUnsupported ? TAGS_UNSUPPORTED_HINT : LOCKED_HINT}
        />
      )}
      {scope.availableOnly && <LockedPill text={AVAILABLE_LABEL} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Filter menus
// ---------------------------------------------------------------------------

/** Wraps a pick: focus back on the trigger, then the change. */
type Choose = (apply: () => void) => () => void;

/**
 * A filter as a pill that opens its menu: "Collection: All", then
 * "Collection: Summer" (soft) once set. The menu renders only while open.
 */
function FilterMenu({
  label,
  value,
  anyValue = 'Any',
  children,
}: {
  label: string;
  /** The current value, or null when the filter is off. */
  value: string | null;
  /** What the pill says while the filter is off. */
  anyValue?: string;
  children: (choose: Choose) => ReactElement;
}) {
  const { ref, refocus } = useTriggerFocus();
  const choose: Choose = (apply) => () => {
    refocus();
    apply();
  };
  return (
    <div ref={ref}>
      <Dropdown
        triggerComponent={PillTrigger}
        label={`${label}: ${value ?? anyValue}`}
        tone={value === null ? 'neutral' : 'soft'}
      >
        {() => <Dropdown.Menu minWidth={220}>{children(choose)}</Dropdown.Menu>}
      </Dropdown>
    </div>
  );
}

function ValuesStatus({
  values,
  empty,
  noun,
}: {
  values: AsyncValue<unknown>;
  empty: boolean;
  noun: string;
}) {
  if (values.status === 'loading' || values.status === 'idle') {
    return <Dropdown.Text>Loading…</Dropdown.Text>;
  }
  if (values.status === 'error') {
    return <Dropdown.Text>Couldn't load the {noun}.</Dropdown.Text>;
  }
  return empty ? (
    <Dropdown.Text>No {noun} to choose from.</Dropdown.Text>
  ) : null;
}

function CollectionOptionsStatus({
  options,
}: {
  options: PagedQuery<CollectionSummary, never>;
}) {
  if (options.status === 'loading' || options.loadingMore) {
    return <Dropdown.Text>Loading…</Dropdown.Text>;
  }
  if (options.status === 'error' || options.loadMoreError) {
    return <Dropdown.Text>Couldn't load the collections.</Dropdown.Text>;
  }
  if (options.status === 'ready' && options.items.length === 0) {
    return (
      <Dropdown.Text>
        No collections are visible to this storefront.
      </Dropdown.Text>
    );
  }
  if (!options.hasNextPage) return null;
  return (
    <Dropdown.Option
      active={false}
      closeMenuOnClick={false}
      onPick={options.loadMore}
    >
      Load more collections
    </Dropdown.Option>
  );
}

function CollectionFilter({
  value,
  options,
  onChange,
}: {
  value: PickerFilters['collection'];
  options: PagedQuery<CollectionSummary, never>;
  onChange: (collection: PickerFilters['collection']) => void;
}) {
  return (
    <FilterMenu label="Collection" value={value?.title ?? null} anyValue="All">
      {(choose) => (
        <>
          <Dropdown.Option
            active={value === null}
            onPick={choose(() => onChange(null))}
          >
            All products
          </Dropdown.Option>
          {options.items.length > 0 && <Dropdown.Separator />}
          {options.items.map((collection) => (
            <Dropdown.Option
              key={collection.id}
              active={value?.id === collection.id}
              keywords={[collection.handle]}
              onPick={choose(() =>
                onChange({ id: collection.id, title: collection.title }),
              )}
            >
              {collection.title}
            </Dropdown.Option>
          ))}
          <CollectionOptionsStatus options={options} />
        </>
      )}
    </FilterMenu>
  );
}

function ProductTypeFilter({
  value,
  values,
  onChange,
}: {
  value: string | null;
  values: AsyncValue<{ productTypes: string[]; tags: string[] }>;
  onChange: (productType: string | null) => void;
}) {
  const productTypes = values.value?.productTypes ?? [];
  return (
    <FilterMenu label="Product type" value={value}>
      {(choose) => (
        <>
          <Dropdown.Option
            active={value === null}
            onPick={choose(() => onChange(null))}
          >
            Any product type
          </Dropdown.Option>
          {productTypes.length > 0 && <Dropdown.Separator />}
          {productTypes.map((productType) => (
            <Dropdown.Option
              key={productType}
              active={value === productType}
              onPick={choose(() => onChange(productType))}
            >
              {productType}
            </Dropdown.Option>
          ))}
          <ValuesStatus
            values={values}
            empty={productTypes.length === 0}
            noun="product types"
          />
        </>
      )}
    </FilterMenu>
  );
}

function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag)
    ? tags.filter((candidate) => candidate !== tag)
    : [...tags, tag];
}

/**
 * Unchecks every tag from the menu's footer. The button leaves with the last
 * checked tag, so it closes the menu and gives focus back to the trigger.
 */
function ClearTagsButton({ onClear }: { onClear: () => void }) {
  const closeMenu = useCloseMenu();
  return (
    <Dropdown.Footer>
      <Button
        tone="ghost"
        size="micro"
        label="Clear tags"
        onClick={() => {
          onClear();
          closeMenu();
        }}
      />
    </Dropdown.Footer>
  );
}

/** A menu of many values: the checkboxes keep it open. */
function TagsFilter({
  value,
  options,
  values,
  onToggle,
  onClear,
}: {
  value: string[];
  /** The tags to offer: the scope's tags when locked, else the store's. */
  options: string[];
  values: AsyncValue<unknown>;
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  return (
    <FilterMenu
      label="Tags"
      value={value.length > 0 ? shortTagsLabel(value) : null}
    >
      {(choose) => (
        <>
          <Dropdown.Text>Shows products with any of these tags.</Dropdown.Text>
          {options.length > 0 && <Dropdown.Separator />}
          {options.map((tag) => (
            <Dropdown.Option
              key={tag}
              checkbox={{
                checked: value.includes(tag),
                onChange: () => onToggle(tag),
              }}
            >
              {tag}
            </Dropdown.Option>
          ))}
          <ValuesStatus
            values={values}
            empty={options.length === 0}
            noun="tags"
          />
          {value.length > 0 && <ClearTagsButton onClear={choose(onClear)} />}
        </>
      )}
    </FilterMenu>
  );
}

/**
 * The menu stops Enter (it picks the highlighted option) and Tab (it closes
 * the menu). Inside the form they submit, and move between the input and
 * Apply; Tab out of the form still closes the menu.
 */
function keepFormKeys(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === 'Enter') {
    event.stopPropagation();
    return;
  }
  if (event.key !== 'Tab') return;
  const leaving = event.shiftKey
    ? event.target instanceof HTMLInputElement
    : event.target instanceof HTMLButtonElement;
  if (!leaving) event.stopPropagation();
}

/** Vendors have no list query: a small form in the menu. */
function VendorForm({
  value,
  onApply,
}: {
  value: string;
  onApply: (vendor: string) => void;
}) {
  const closeMenu = useCloseMenu();
  const [draft, setDraft] = useState<string | null>(value);

  // The menu focuses itself once it mounts: the input takes it right after.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      document.getElementById(VENDOR_INPUT_ID)?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply((draft ?? '').trim());
    closeMenu();
  };

  return (
    <form onSubmit={submit} onKeyDown={keepFormKeys}>
      <div className="Dropdown__menu__body">
        <FieldWrapper id={VENDOR_INPUT_ID} label="Vendor">
          <StringInput
            value={draft}
            onChange={setDraft}
            placeholder="Acme"
            autoComplete="off"
            spellCheck={false}
          />
        </FieldWrapper>
        <Button tone="primary" size="small" submit label="Apply" />
      </div>
    </form>
  );
}

function VendorFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (vendor: string) => void;
}) {
  const applied = value.trim();
  return (
    <FilterMenu label="Vendor" value={applied === '' ? null : applied}>
      {(choose) => (
        <>
          <Dropdown.Option
            active={applied === ''}
            onPick={choose(() => onChange(''))}
          >
            Any vendor
          </Dropdown.Option>
          <Dropdown.Separator />
          <VendorForm
            value={applied}
            onApply={(vendor) => choose(() => onChange(vendor))()}
          />
        </>
      )}
    </FilterMenu>
  );
}

function AvailabilityFilter({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (availableOnly: boolean) => void;
}) {
  return (
    <FilterMenu label="Availability" value={value ? AVAILABLE_LABEL : null}>
      {(choose) => (
        <>
          <Dropdown.Option
            active={!value}
            onPick={choose(() => onChange(false))}
          >
            Any availability
          </Dropdown.Option>
          <Dropdown.Option active={value} onPick={choose(() => onChange(true))}>
            {AVAILABLE_LABEL}
          </Dropdown.Option>
        </>
      )}
    </FilterMenu>
  );
}

function SortMenu({
  sort,
  sortContext,
  onChange,
}: {
  sort: PickerSort;
  sortContext: SortContext;
  onChange: (sort: PickerSort) => void;
}) {
  const { ref, refocus } = useTriggerFocus();
  const options = PICKER_SORT_OPTIONS.filter((option) =>
    isSortAvailable(option.value, sortContext),
  );
  const current =
    PICKER_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? '';
  return (
    <div ref={ref}>
      <Dropdown
        triggerComponent={ButtonTrigger}
        tone="ghost"
        label={`Sort: ${current}`}
      >
        <Dropdown.Menu placement="bottom-end">
          {options.map((option) => (
            <Dropdown.Option
              key={option.value}
              active={option.value === sort}
              onPick={() => {
                refocus();
                onChange(option.value);
              }}
            >
              {option.label}
            </Dropdown.Option>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

export type FilterBarProps = {
  scope: FieldScope | undefined;
  lockedCollectionTitle: string | null;
  filters: PickerFilters;
  setFilters: SetFilters;
  /** Resets the editor's filters and moves focus to the search. */
  clearFilters: () => void;
  filtersActive: boolean;
  controls: CollectionControls;
  inCollection: boolean;
  support: CollectionFilterSupport | null;
  tagsCapability: boolean;
  /** The store's capabilities are still being detected. */
  tagsPending: boolean;
  filterValues: AsyncValue<{ productTypes: string[]; tags: string[] }>;
  collectionOptions: PagedQuery<CollectionSummary, never>;
  sort: PickerSort;
  sortContext: SortContext;
};

function tagOptions(
  scope: FieldScope,
  values: FilterBarProps['filterValues'],
): string[] {
  return scope.tags && scope.tags.length > 0
    ? scope.tags
    : (values.value?.tags ?? []);
}

/** What the pill of each editor filter says while it's kept, not applied. */
function keptLabels(filters: PickerFilters) {
  const vendor = filters.vendor.trim();
  return {
    productType:
      filters.productType === null
        ? null
        : `Product type: ${filters.productType}`,
    tags:
      filters.tags.length > 0 ? `Tags: ${shortTagsLabel(filters.tags)}` : null,
    vendor: vendor === '' ? null : `Vendor: ${vendor}`,
    availability: filters.availableOnly ? AVAILABLE_LABEL : null,
  };
}

/**
 * The filter's menu, or, inside a collection whose Search & Discovery
 * settings don't enable it, the value the editor had set as a warning pill
 * (nothing when it wasn't set).
 */
function Applicable({
  applies,
  kept,
  children,
}: {
  applies: boolean;
  kept: string | null;
  children: ReactElement;
}) {
  if (applies) return children;
  return kept === null ? null : <NotAppliedPill text={kept} />;
}

/** Tags wait for detection, and a scope of one tag leaves nothing to choose. */
function showsTags(props: FilterBarProps): boolean {
  return (
    props.tagsCapability &&
    !props.tagsPending &&
    (props.scope?.tags?.length ?? 0) !== 1
  );
}

/** Inside a collection whose Search & Discovery settings lack the tag filter. */
function tagsUnsupportedIn(props: FilterBarProps): boolean {
  return props.inCollection && props.support !== null && !props.support.tag;
}

/** `"vendor"`, `"product type and vendor"`, `"product type, tags and vendor"`. */
function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The editor's filters that show as warning pills: kept, not applied. */
function notAppliedFilters(props: FilterBarProps): string[] {
  const scope = props.scope ?? {};
  const { controls } = props;
  const kept = keptLabels(props.filters);
  const candidates: [string, boolean][] = [
    [
      'product type',
      !scope.productType && !controls.productType && kept.productType !== null,
    ],
    ['tags', showsTags(props) && !controls.tags && kept.tags !== null],
    ['vendor', !scope.vendor && !controls.vendor && kept.vendor !== null],
    [
      'availability',
      !scope.availableOnly &&
        !controls.availability &&
        kept.availability !== null,
    ],
  ];
  return candidates
    .filter(([, notApplied]) => notApplied)
    .map(([name]) => name);
}

/** How the sentence ends: what Search & Discovery has to enable. */
function untilEnabled(filters: readonly string[], tagLimit: boolean): string {
  if (tagLimit) {
    return filters.length === 0
      ? 'the tag filter is enabled'
      : 'their filters are enabled';
  }
  return filters.length === 1 ? "it's enabled" : "they're enabled";
}

/**
 * What the browsed collection keeps but can't apply, in a sentence for the
 * results: the editor's filters that show as warning pills, and the tag
 * limit of the field settings. Null when everything applies.
 */
export function notAppliedNotice(props: FilterBarProps): string | null {
  const filters = notAppliedFilters(props);
  const tagLimit =
    tagsUnsupportedIn(props) && (props.scope?.tags?.length ?? 0) > 0;
  const parts: string[] = [];
  if (tagLimit) parts.push("the field's tag limit");
  if (filters.length > 0) {
    const noun = filters.length === 1 ? 'filter' : 'filters';
    parts.push(`the ${joinWithAnd(filters)} ${noun}`);
  }
  if (parts.length === 0) return null;
  return `Shopify can't apply ${parts.join(' and ')} inside this collection until ${untilEnabled(filters, tagLimit)} in Search & Discovery.`;
}

/** The editor's filters, for what the scope leaves open. */
function EditorFilters(props: FilterBarProps) {
  const { filters, setFilters, controls } = props;
  const scope = props.scope ?? {};
  const set = (patch: Partial<PickerFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const showTags = showsTags(props);
  const kept = keptLabels(filters);

  return (
    <>
      {!scope.collectionId && (
        <CollectionFilter
          value={filters.collection}
          options={props.collectionOptions}
          onChange={(collection) => set({ collection })}
        />
      )}
      {!scope.productType && (
        <Applicable applies={controls.productType} kept={kept.productType}>
          <ProductTypeFilter
            value={filters.productType}
            values={props.filterValues}
            onChange={(productType) => set({ productType })}
          />
        </Applicable>
      )}
      {showTags && (
        <Applicable applies={controls.tags} kept={kept.tags}>
          <TagsFilter
            value={filters.tags}
            options={tagOptions(scope, props.filterValues)}
            values={props.filterValues}
            onToggle={(tag) =>
              setFilters((current) => ({
                ...current,
                tags: toggleTag(current.tags, tag),
              }))
            }
            onClear={() => set({ tags: [] })}
          />
        </Applicable>
      )}
      {!scope.vendor && (
        <Applicable applies={controls.vendor} kept={kept.vendor}>
          <VendorFilter
            value={filters.vendor}
            onChange={(vendor) => set({ vendor })}
          />
        </Applicable>
      )}
      {!scope.availableOnly && (
        <Applicable applies={controls.availability} kept={kept.availability}>
          <AvailabilityFilter
            value={filters.availableOnly}
            onChange={(availableOnly) => set({ availableOnly })}
          />
        </Applicable>
      )}
    </>
  );
}

/**
 * The second bar of the header, for products and variants: the field's
 * locked scope, the editor's filters, Clear filters and the sort.
 */
export default function FilterBar(props: FilterBarProps) {
  const scope = props.scope ?? {};
  return (
    <Toolbar style="short">
      <Toolbar.Search ariaLabel="Product filters" className={styles.filters}>
        <ScopePills
          scope={scope}
          collectionTitle={props.lockedCollectionTitle}
          tagsUnsupported={tagsUnsupportedIn(props)}
        />
        <EditorFilters {...props} />
      </Toolbar.Search>
      {props.filtersActive && (
        <Toolbar.Button label="Clear filters" onClick={props.clearFilters} />
      )}
      <SortMenu
        sort={props.sort}
        sortContext={props.sortContext}
        onChange={(sort) =>
          props.setFilters((current) => ({ ...current, sort }))
        }
      />
    </Toolbar>
  );
}
