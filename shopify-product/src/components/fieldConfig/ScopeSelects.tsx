import {
  CreatableSelectInput,
  FieldHint,
  FieldWrapper,
  SelectInput,
} from 'datocms-react-ui';
import type { CollectionSummary, FieldScope } from '../../types';
import type { AsyncValue } from '../shared/useAsyncValue';
import { COLLECTION_MISSING_WARNING, TAGS_IN_COLLECTION_WARNING } from './copy';
import { describe, describedBy, useInputDescription } from './describe';
import { joinWithOr } from './draft';
import styles from './ScopeSection.module.css';
import type { FilterValues } from './useShopifyOptions';
import WarningNote from './WarningNote';

type Option = { value: string; label: string; hint?: string };

type ScopeChange = (patch: Partial<FieldScope>) => void;

function OptionLabel(option: Option, meta: { context: 'menu' | 'value' }) {
  if (meta.context === 'value' || !option.hint) return option.label;
  return (
    <span className={styles.option}>
      <span>{option.label}</span>
      <span className={styles.optionHint}>{option.hint}</span>
    </span>
  );
}

function textOptions(values: readonly string[], current: readonly string[]) {
  const all = [...values];
  for (const value of current) {
    if (!all.includes(value)) all.push(value);
  }
  return all.map((value) => ({ value, label: value }));
}

/** A searchable list of the store's collections (title prefix search). */
export function CollectionField({
  collections,
  search,
  onSearch,
  scope,
  missing,
  onChange,
}: {
  collections: AsyncValue<CollectionSummary[]>;
  search: string;
  onSearch: (text: string) => void;
  scope: FieldScope | undefined;
  /** Shopify didn't return the limited collection. */
  missing: boolean;
  onChange: ScopeChange;
}) {
  const options: Option[] = (collections.value ?? []).map((collection) => ({
    value: collection.id,
    label: collection.title,
    hint: collection.handle,
  }));
  const value = scope?.collectionId
    ? {
        value: scope.collectionId,
        label: scope.collectionTitle ?? scope.collectionId,
      }
    : null;
  const described = describe(
    'scope-collection',
    'Editors only see products from this collection',
    undefined,
  );
  const warningId = 'scope-collection-warning';
  useInputDescription(
    'scope-collection',
    describedBy(missing && warningId, described.ids),
  );

  return (
    <div>
      <FieldWrapper
        id="scope-collection"
        label="Collection"
        hint={described.hint}
      >
        <SelectInput<Option, false>
          inputId="scope-collection"
          value={value}
          options={options}
          isClearable
          isLoading={collections.status === 'loading'}
          filterOption={null}
          placeholder="Select a collection…"
          loadingMessage={() => 'Loading collections…'}
          noOptionsMessage={() =>
            search.trim() ? 'No collections match' : 'No collections found'
          }
          formatOptionLabel={OptionLabel}
          onInputChange={(text) => onSearch(text)}
          onChange={(option) =>
            onChange({
              collectionId: option?.value,
              collectionTitle: option?.label,
            })
          }
        />
      </FieldWrapper>
      {missing && (
        <WarningNote id={warningId}>{COLLECTION_MISSING_WARNING}</WarningNote>
      )}
    </div>
  );
}

type FilterProps = {
  filters: AsyncValue<FilterValues>;
  scope: FieldScope | undefined;
  onChange: ScopeChange;
};

/** Product types come from the store; typing one that isn't listed works too. */
export function ProductTypeField({ filters, scope, onChange }: FilterProps) {
  const current = scope?.productType;
  const described = describe(
    'scope-product-type',
    'Editors only see products of this type',
    undefined,
  );
  useInputDescription('scope-product-type', described.ids);
  return (
    <div>
      <FieldWrapper
        id="scope-product-type"
        label="Product type"
        hint={described.hint}
      >
        <CreatableSelectInput<Option, false>
          inputId="scope-product-type"
          value={current ? { value: current, label: current } : null}
          options={textOptions(
            filters.value?.productTypes ?? [],
            current ? [current] : [],
          )}
          isClearable
          isLoading={filters.status === 'loading'}
          placeholder="Select a product type…"
          loadingMessage={() => 'Loading product types…'}
          noOptionsMessage={() => 'No product types found'}
          formatCreateLabel={(text) => `Use "${text}"`}
          onChange={(option) => onChange({ productType: option?.value })}
        />
      </FieldWrapper>
    </div>
  );
}

/**
 * Whether Shopify applies a tag limit: always outside a collection, and
 * inside one only with the Tag filter enabled in Search & Discovery.
 */
export type TagFilterSupport = 'applies' | 'ignored' | 'unknown';

function tagsHint(tags: readonly string[], support: TagFilterSupport): string {
  return tags.length > 1 && support === 'applies'
    ? `Editors only see products tagged ${joinWithOr(tags)}`
    : 'With several tags, editors see products that have any of them';
}

/**
 * Whether the store's token can read tags. `checking` while a store saved
 * without capabilities is checked in the background; `unknown` when that
 * check failed, so the control stays offered.
 */
export type TagsAccess =
  | 'granted'
  | 'checking'
  | 'unknown'
  | 'denied'
  | 'tokenless';

const TAGS_UNAVAILABLE_HINT: Record<'denied' | 'tokenless', string> = {
  denied:
    'To limit choices by tag, enable "Read product tags" in Shopify (Headless → Storefront API permissions), then check the connection again in the plugin settings',
  tokenless:
    'To limit choices by tag, connect this store with a Storefront access token in the plugin settings',
};

type TagsProps = FilterProps & {
  access: TagsAccess;
  support: TagFilterSupport;
};

/** Tags need the "Read product tags" Storefront permission. */
export function TagsField(props: TagsProps) {
  const { access, scope } = props;
  if (
    (access === 'denied' || access === 'tokenless') &&
    (scope?.tags ?? []).length === 0
  ) {
    return (
      <div>
        <div className={styles.staticLabel}>Tags</div>
        <FieldHint>{TAGS_UNAVAILABLE_HINT[access]}</FieldHint>
      </div>
    );
  }
  return <TagsSelect {...props} />;
}

/** Its own component, so the input's description is set when it mounts. */
function TagsSelect({ filters, scope, onChange, access, support }: TagsProps) {
  const current = scope?.tags ?? [];
  const described = describe(
    'scope-tags',
    tagsHint(current, support),
    undefined,
  );
  const ignored = current.length > 0 && support === 'ignored';
  const warningId = 'scope-tags-warning';
  useInputDescription(
    'scope-tags',
    describedBy(ignored && warningId, described.ids),
  );
  return (
    <div>
      <FieldWrapper id="scope-tags" label="Tags" hint={described.hint}>
        <CreatableSelectInput<Option, true>
          inputId="scope-tags"
          isMulti
          value={current.map((tag) => ({ value: tag, label: tag }))}
          options={textOptions(filters.value?.tags ?? [], current)}
          isLoading={filters.status === 'loading' || access === 'checking'}
          placeholder="Select tags…"
          loadingMessage={() => 'Loading tags…'}
          noOptionsMessage={() => 'No tags found'}
          formatCreateLabel={(text) => `Use "${text}"`}
          onChange={(options) =>
            onChange({ tags: options.map((option) => option.value) })
          }
        />
      </FieldWrapper>
      {ignored && (
        <WarningNote id={warningId}>{TAGS_IN_COLLECTION_WARNING}</WarningNote>
      )}
    </div>
  );
}
