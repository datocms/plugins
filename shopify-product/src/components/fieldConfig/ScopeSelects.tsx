import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import type { CollectionSummary, FieldScope } from '../../types';
import type { AsyncValue } from '../shared/useAsyncValue';
import { COLLECTION_MISSING_WARNING, TAGS_IN_COLLECTION_WARNING } from './copy';
import { joinWithOr } from './draft';
import { fieldNotice } from './notices';
import type { FilterValues } from './useShopifyOptions';

/** `details`: a second line in the menu (a collection's handle). */
type Option = { value: string; label: string; details?: string };

type ScopeChange = (patch: Partial<FieldScope>) => void;

function formatOptionLabel(
  option: Option,
  meta: { context: 'menu' | 'value' },
) {
  if (meta.context === 'value' || !option.details) return option.label;
  return (
    <EntityRow layout="row" title={option.label}>
      {option.details}
    </EntityRow>
  );
}

/** The menu option that adds a value the store didn't list. */
function createLabel(text: string): string {
  return `Use “${text}”`;
}

function textOptions(
  values: readonly string[],
  current: readonly string[],
): Option[] {
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
    details: collection.handle,
  }));
  return (
    <FieldWrapper
      id="scope-collection"
      label="Collection"
      hint="Editors only see products from this collection."
      container={fieldNotice(missing ? COLLECTION_MISSING_WARNING : null)}
    >
      <SelectInput
        name="scope-collection"
        value={scope?.collectionId ?? null}
        options={options}
        clearable
        loading={collections.status === 'loading'}
        search={{ onQueryChange: onSearch }}
        placeholder="Select a collection"
        loadingMessage={() => 'Loading collections…'}
        noOptionsMessage={() =>
          search.trim() ? 'No collections match' : 'No collections found'
        }
        formatOptionLabel={formatOptionLabel}
        // The saved collection, before (or without) the list that has it.
        acceptValueNotIncludedInOptions={(value) => ({
          value,
          label: scope?.collectionTitle ?? value,
        })}
        onChange={(value, option) =>
          onChange({
            collectionId: value ?? undefined,
            collectionTitle: option?.label,
          })
        }
      />
    </FieldWrapper>
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
  return (
    <FieldWrapper
      id="scope-product-type"
      label="Product type"
      hint="Editors only see products of this type."
    >
      <SelectInput
        name="scope-product-type"
        value={current ?? null}
        options={textOptions(
          filters.value?.productTypes ?? [],
          current ? [current] : [],
        )}
        clearable
        loading={filters.status === 'loading'}
        creatable={{
          onCreate: (productType) => onChange({ productType }),
          formatLabel: createLabel,
        }}
        placeholder="Select a product type"
        loadingMessage={() => 'Loading product types…'}
        noOptionsMessage={() => 'No product types found'}
        onChange={(productType) =>
          onChange({ productType: productType ?? undefined })
        }
      />
    </FieldWrapper>
  );
}

/**
 * Whether Shopify applies a tag limit: always outside a collection, and
 * inside one only with the Tag filter enabled in Search & Discovery.
 */
export type TagFilterSupport = 'applies' | 'ignored' | 'unknown';

function tagsHint(tags: readonly string[], support: TagFilterSupport): string {
  return tags.length > 1 && support === 'applies'
    ? `Editors only see products tagged ${joinWithOr(tags)}.`
    : 'With several tags, editors see products that have any of them.';
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
    'To limit choices by tag, enable "Read product tags" in Shopify (Headless → Storefront API permissions), then check the connection again in the plugin settings.',
  tokenless:
    'To limit choices by tag, connect this store with a Storefront access token in the plugin settings.',
};

/** Why tags can't be offered: the token can't read them and none are saved. */
function unavailableReason(
  access: TagsAccess,
  current: readonly string[],
): string | null {
  if (current.length > 0) return null;
  return access === 'denied' || access === 'tokenless'
    ? TAGS_UNAVAILABLE_HINT[access]
    : null;
}

type TagsProps = FilterProps & {
  access: TagsAccess;
  support: TagFilterSupport;
};

/**
 * Tags need the "Read product tags" Storefront permission. Without it the
 * select stays disabled with the way to grant it, unless tags are already
 * saved (so they can still be removed).
 */
export function TagsField({
  filters,
  scope,
  onChange,
  access,
  support,
}: TagsProps) {
  const current = scope?.tags ?? [];
  const unavailable = unavailableReason(access, current);
  const ignored = current.length > 0 && support === 'ignored';
  return (
    <FieldWrapper
      id="scope-tags"
      label="Tags"
      hint={unavailable ?? tagsHint(current, support)}
      container={fieldNotice(ignored ? TAGS_IN_COLLECTION_WARNING : null)}
    >
      <SelectInput
        name="scope-tags"
        multiple
        value={current}
        options={textOptions(filters.value?.tags ?? [], current)}
        disabled={unavailable !== null}
        loading={
          unavailable === null &&
          (filters.status === 'loading' || access === 'checking')
        }
        creatable={{
          onCreate: (tag) => onChange({ tags: [...current, tag] }),
          formatLabel: createLabel,
        }}
        placeholder="Select tags"
        loadingMessage={() => 'Loading tags…'}
        noOptionsMessage={() => 'No tags found'}
        onChange={(tags) => onChange({ tags: tags ?? [] })}
      />
    </FieldWrapper>
  );
}
