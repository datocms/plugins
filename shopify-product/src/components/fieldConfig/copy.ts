import { UNRESOLVED_COLLECTION_MESSAGE } from '../../lib/fieldValue';
import type {
  Cardinality,
  FieldParametersV1,
  FieldType,
  ShopifyKind,
  StorageFormat,
} from '../../types';

export const KIND_NOUNS: Record<ShopifyKind, { one: string; many: string }> = {
  product: { one: 'product', many: 'products' },
  variant: { one: 'product variant', many: 'product variants' },
  collection: { one: 'collection', many: 'collections' },
};

export const KIND_OPTIONS: Array<{
  value: ShopifyKind;
  label: string;
  description: string;
}> = [
  {
    value: 'product',
    label: 'Products',
    description: 'A product with all its variants, prices and images',
  },
  {
    value: 'variant',
    label: 'Product variants',
    description:
      'One version of a product, like Black / M, with its own SKU and price',
  },
  {
    value: 'collection',
    label: 'Collections',
    description: 'A group of products, curated by hand or by rules',
  },
];

/** Why a kind can't be picked with a format (shown in place of its description). */
export function kindUnavailableReason(format: StorageFormat): string {
  return format === 'handle'
    ? 'Needs the Shopify ID format, since variants have no handle'
    : 'Needs the reference document format';
}

export type FormatOption = {
  value: StorageFormat;
  label: string;
  description: string;
  badge?: string;
};

export const FORMAT_OPTIONS: Record<FieldType, FormatOption[]> = {
  json: [
    {
      value: 'reference',
      label: 'Reference document',
      description:
        'Versioned JSON with Shopify IDs and handles, for one or more items',
      badge: 'Recommended',
    },
    {
      value: 'legacyProductJson',
      label: 'Legacy product JSON',
      description: 'The product data 1.x stored, one product per field',
    },
  ],
  string: [
    {
      value: 'handle',
      label: 'Handle',
      description: 'The product or collection handle, as 1.x stored it',
    },
    {
      value: 'gid',
      label: 'Shopify ID',
      description: 'The global ID (gid://shopify/…), for any kind of item',
    },
  ],
};

export const CARDINALITY_OPTIONS: Array<{
  value: Cardinality;
  label: string;
}> = [
  { value: 'single', label: 'One' },
  { value: 'multiple', label: 'Multiple' },
];

export function cardinalityHint(
  cardinality: Cardinality,
  kind: ShopifyKind,
): string {
  return cardinality === 'single'
    ? `Editors pick a single ${KIND_NOUNS[kind].one}`
    : `Editors pick several ${KIND_NOUNS[kind].many} and drag them into order`;
}

export const LEGACY_NOTICE: Record<FieldType, string> = {
  string:
    'This field uses the 1.x settings (product handle). Existing values keep working; change the options below to opt in to the new formats.',
  json: 'This field uses the 1.x settings (product JSON). Existing values keep working; change the options below to opt in to the new formats.',
};

export const UNSUPPORTED_NOTICE =
  "These field settings come from an unknown plugin version, so they haven't been changed. The options below show the 1.x defaults: change any of them to replace the saved settings.";

export const FORMAT_CHANGE_NOTICE =
  'Existing records keep their current value until an editor converts or replaces it. Make sure your frontend reads both formats during the transition.';

export function storeChangeNotice(previousStore: string): string {
  return `Existing records point to items in ${previousStore}. Editors have to pick them again from the new store.`;
}

export const CARDINALITY_CHANGE_NOTICE =
  'Records that already hold several items show an error until an editor picks a single one again.';

export const REPAIR_NOTICE =
  'The options below show the closest valid settings. Use them as they are, or change any option.';

export const TAGS_IN_COLLECTION_WARNING =
  "Shopify can't apply tag limits inside this collection until the Tag filter is enabled in the Search & Discovery app";

/** The field editor's and the picker's sentence for the same case. */
export const COLLECTION_MISSING_WARNING = UNRESOLVED_COLLECTION_MESSAGE;

/** One line under the live example: what the frontend receives. */
export function exampleHint(params: FieldParametersV1): string {
  const noun = KIND_NOUNS[params.kind].one;
  switch (params.format) {
    case 'handle':
      return `The handle of the selected ${noun}, as a plain string`;
    case 'gid':
      return `The Shopify ID of the selected ${noun}, as a plain string`;
    case 'legacyProductJson':
      return 'The same product JSON 1.x stored, so existing frontends keep working';
    case 'reference':
      return params.snapshot
        ? 'Snapshots are display hints captured at selection time; Shopify stays the source of truth'
        : 'Resolve the IDs with the Storefront API to render live data';
  }
}

/** The example's `shop` when no store is connected yet. */
export const EXAMPLE_SHOP_PLACEHOLDER = 'your-store.myshopify.com';
