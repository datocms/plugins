import { faAnglesDown } from '@fortawesome/free-solid-svg-icons';
import {
  CaretDownIcon,
  CaretUpIcon,
  DropdownOption,
  DropdownSeparator,
  DropdownText,
} from 'datocms-react-ui';
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
import { Icon } from '../../ui/Icon';
import { Menu, MenuAction } from '../../ui/Menu';
import styles from './FilterBar.module.css';
import {
  DisabledChip,
  LockedChip,
  LOCKED_TOOLTIP,
  MenuChip,
  TextChip,
  ToggleChip,
} from './FilterChips';
import type { AsyncValue } from '../shared/useAsyncValue';
import type { PagedQuery } from './usePagedQuery';

type SetFilters = (update: (current: PickerFilters) => PickerFilters) => void;

const TAGS_UNSUPPORTED_TOOLTIP =
  "Set in the field settings. Shopify can't apply it inside this collection until the tag filter is enabled in Search & Discovery.";

const TAGS_CHECKING_TOOLTIP =
  'Checking whether the token can read product tags…';

/** The availability filter, named as in the field settings (`availableForSale`). */
const AVAILABLE_LABEL = 'Available for sale';

/** `"Accessory"`, `"Accessory or Premium"`, `"Accessory +2"`. */
function shortTagsLabel(tags: readonly string[]): string {
  return tags.length <= 2 ? tagsLabel(tags) : `${tags[0]} +${tags.length - 1}`;
}

// ---------------------------------------------------------------------------
// Locked scope
// ---------------------------------------------------------------------------

function ScopeChips({
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
        <LockedChip label="Collection" value={collectionTitle ?? 'Loading…'} />
      )}
      {scope.productType && (
        <LockedChip label="Product type" value={scope.productType} />
      )}
      {scope.vendor && <LockedChip label="Vendor" value={scope.vendor} />}
      {tags.length > 0 && (
        <LockedChip
          label="Tags"
          value={tagsLabel(tags)}
          tooltip={tagsUnsupported ? TAGS_UNSUPPORTED_TOOLTIP : LOCKED_TOOLTIP}
        />
      )}
      {scope.availableOnly && <LockedChip label={AVAILABLE_LABEL} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor filters
// ---------------------------------------------------------------------------

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
    <MenuChip label="Collection" value={value?.title}>
      <DropdownOption active={value === null} onClick={() => onChange(null)}>
        All products
      </DropdownOption>
      <DropdownSeparator />
      {options.items.map((collection) => (
        <DropdownOption
          key={collection.id}
          active={value?.id === collection.id}
          onClick={() =>
            onChange({ id: collection.id, title: collection.title })
          }
        >
          {collection.title}
        </DropdownOption>
      ))}
      <CollectionOptionsStatus options={options} />
    </MenuChip>
  );
}

function CollectionOptionsStatus({
  options,
}: {
  options: PagedQuery<CollectionSummary, never>;
}) {
  if (options.status === 'loading' || options.loadingMore) {
    return <DropdownText>Loading…</DropdownText>;
  }
  if (options.status === 'error' || options.loadMoreError) {
    return <DropdownText>Couldn't load the collections</DropdownText>;
  }
  if (options.status === 'ready' && options.items.length === 0) {
    return (
      <DropdownText>No collections are visible to this storefront</DropdownText>
    );
  }
  if (!options.hasNextPage) return null;
  return (
    <DropdownOption closeMenuOnClick={false} onClick={options.loadMore}>
      <MenuAction />
      <Icon icon={faAnglesDown} />
      Load more collections
    </DropdownOption>
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
    <MenuChip label="Product type" value={value}>
      <DropdownOption active={value === null} onClick={() => onChange(null)}>
        Any product type
      </DropdownOption>
      <DropdownSeparator />
      {productTypes.map((productType) => (
        <DropdownOption
          key={productType}
          active={value === productType}
          onClick={() => onChange(productType)}
        >
          {productType}
        </DropdownOption>
      ))}
      <ValuesStatus values={values} empty={productTypes.length === 0} />
    </MenuChip>
  );
}

function ValuesStatus({
  values,
  empty,
}: {
  values: AsyncValue<unknown>;
  empty: boolean;
}) {
  if (values.status === 'loading') return <DropdownText>Loading…</DropdownText>;
  if (values.status === 'error') {
    return <DropdownText>Couldn't load the values</DropdownText>;
  }
  return empty ? <DropdownText>Nothing to choose from</DropdownText> : null;
}

function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag)
    ? tags.filter((candidate) => candidate !== tag)
    : [...tags, tag];
}

function TagsFilter({
  value,
  options,
  values,
  onChange,
}: {
  value: string[];
  /** The tags to offer: the scope's tags when locked, else the store's. */
  options: string[];
  values: AsyncValue<unknown>;
  onChange: (tags: string[]) => void;
}) {
  return (
    <MenuChip
      label="Tags"
      value={value.length > 0 ? shortTagsLabel(value) : null}
      selection="multiple"
    >
      <DropdownText>Products with any of these tags</DropdownText>
      {value.length > 0 && (
        <DropdownOption onClick={() => onChange([])}>
          <MenuAction />
          Any tag
        </DropdownOption>
      )}
      <DropdownSeparator />
      {/* Checked tags are bold, like every menu's current value
          (components.md §10), and read as checked menu checkboxes. */}
      {options.map((tag) => (
        <DropdownOption
          key={tag}
          active={value.includes(tag)}
          closeMenuOnClick={false}
          onClick={() => onChange(toggleTag(value, tag))}
        >
          {tag}
        </DropdownOption>
      ))}
      <ValuesStatus values={values} empty={options.length === 0} />
    </MenuChip>
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
  const options = PICKER_SORT_OPTIONS.filter((option) =>
    isSortAvailable(option.value, sortContext),
  );
  const current =
    PICKER_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? '';
  return (
    <Menu
      alignment="right"
      selection="single"
      renderTrigger={({ open, triggerProps }) => (
        <button {...triggerProps} type="button" className={styles.sortTrigger}>
          Sort: <span className={styles.sortValue}>{current}</span>
          {open ? <CaretUpIcon /> : <CaretDownIcon />}
        </button>
      )}
    >
      {options.map((option) => (
        <DropdownOption
          key={option.value}
          active={option.value === sort}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </DropdownOption>
      ))}
    </Menu>
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

type ControlProps = {
  props: FilterBarProps;
  set: (patch: Partial<PickerFilters>) => void;
};

function ProductTypeControl({ props, set }: ControlProps) {
  const value = props.filters.productType;
  if (!props.controls.productType) {
    return (
      <DisabledChip label="Product type" value={value} kept={value !== null} />
    );
  }
  return (
    <ProductTypeFilter
      value={value}
      values={props.filterValues}
      onChange={(productType) => set({ productType })}
    />
  );
}

function TagsControl({ props, set }: ControlProps) {
  const value = props.filters.tags;
  if (props.tagsPending) {
    // Holds the chip's place, so the bar doesn't shift once detection ends.
    return <DisabledChip label="Tags" tooltip={TAGS_CHECKING_TOOLTIP} />;
  }
  if (!props.controls.tags) {
    return (
      <DisabledChip
        label="Tags"
        value={value.length > 0 ? shortTagsLabel(value) : null}
        kept={value.length > 0}
      />
    );
  }
  return (
    <TagsFilter
      value={value}
      options={tagOptions(props.scope ?? {}, props.filterValues)}
      values={props.filterValues}
      onChange={(tags) => set({ tags })}
    />
  );
}

function VendorControl({ props, set }: ControlProps) {
  const value = props.filters.vendor;
  if (!props.controls.vendor) {
    const kept = value.trim() !== '';
    return (
      <DisabledChip
        label="Vendor"
        value={kept ? value.trim() : null}
        kept={kept}
        menu={false}
      />
    );
  }
  return (
    <TextChip
      label="Vendor"
      value={value}
      onChange={(vendor) => set({ vendor })}
    />
  );
}

function AvailabilityControl({ props, set }: ControlProps) {
  const pressed = props.filters.availableOnly;
  if (!props.controls.availability) {
    return <DisabledChip label={AVAILABLE_LABEL} kept={pressed} menu={false} />;
  }
  return (
    <ToggleChip
      label={AVAILABLE_LABEL}
      pressed={pressed}
      onToggle={() => set({ availableOnly: !pressed })}
    />
  );
}

function EditorFilters(props: FilterBarProps) {
  const { filters, setFilters } = props;
  const scope = props.scope ?? {};
  const set = (patch: Partial<PickerFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const showTags =
    (props.tagsCapability || props.tagsPending) &&
    (scope.tags?.length ?? 0) !== 1;
  const control = { props, set };

  return (
    <>
      {!scope.collectionId && (
        <CollectionFilter
          value={filters.collection}
          options={props.collectionOptions}
          onChange={(collection) => set({ collection })}
        />
      )}
      {!scope.productType && <ProductTypeControl {...control} />}
      {showTags && <TagsControl {...control} />}
      {!scope.vendor && <VendorControl {...control} />}
      {!scope.availableOnly && <AvailabilityControl {...control} />}
    </>
  );
}

function hasScope(scope: FieldScope): boolean {
  return Boolean(
    scope.collectionId ||
      scope.productType ||
      scope.vendor ||
      (scope.tags?.length ?? 0) > 0 ||
      scope.availableOnly,
  );
}

/** Row 2 of the header for products and variants. */
export default function FilterBar(props: FilterBarProps) {
  const scope = props.scope ?? {};
  const tagsUnsupported =
    props.inCollection && props.support !== null && !props.support.tag;
  return (
    <div className={styles.bar} role="group" aria-label="Filters">
      <div className={styles.chips}>
        {hasScope(scope) && (
          <div className={styles.lockedGroup}>
            <ScopeChips
              scope={scope}
              collectionTitle={props.lockedCollectionTitle}
              tagsUnsupported={tagsUnsupported}
            />
          </div>
        )}
        <div className={styles.editorGroup}>
          <EditorFilters {...props} />
        </div>
      </div>
      <div className={styles.end}>
        {props.filtersActive && (
          <button
            type="button"
            className={styles.clearFilters}
            onClick={props.clearFilters}
          >
            Clear filters
          </button>
        )}
        <SortMenu
          sort={props.sort}
          sortContext={props.sortContext}
          onChange={(sort) =>
            props.setFilters((current) => ({ ...current, sort }))
          }
        />
      </div>
    </div>
  );
}
