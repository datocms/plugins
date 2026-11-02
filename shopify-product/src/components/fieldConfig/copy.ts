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
    description: 'A product with all its variants, prices and images.',
  },
  {
    value: 'variant',
    label: 'Product variants',
    description:
      'One version of a product, like Black / M, with its own SKU and price.',
  },
  {
    value: 'collection',
    label: 'Collections',
    description: 'A group of products, curated by hand or by rules.',
  },
];

/** Why a kind can't be picked with a format (its hint, in place of its description). */
export function kindUnavailableReason(format: StorageFormat): string {
  return format === 'handle'
    ? 'Needs the Shopify ID format, since variants have no handle.'
    : 'Needs the reference document format.';
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
        'Versioned JSON with Shopify IDs and handles, for one or more items.',
      badge: 'Recommended',
    },
    {
      value: 'legacyProductJson',
      label: 'Legacy product JSON',
      description:
        'The product data as the first version of this plugin saved it, one product per field.',
    },
  ],
  string: [
    {
      value: 'handle',
      label: 'Handle',
      description:
        'The product or collection handle, as the first version of this plugin saved it.',
    },
    {
      value: 'gid',
      label: 'Shopify ID',
      description: 'The global ID (gid://shopify/…), for any kind of item.',
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

/** The hint of each "How many" option. */
export function cardinalityHint(
  cardinality: Cardinality,
  kind: ShopifyKind,
): string {
  return cardinality === 'single'
    ? `Editors pick a single ${KIND_NOUNS[kind].one}.`
    : `Editors pick several ${KIND_NOUNS[kind].many} and put them in order.`;
}

/*
 * Notices of more than one sentence get a title that names the problem in a
 * few words (Callout).
 */

/** The field still has the settings of the plugin's first version (1.x). */
export const LEGACY_NOTICE_TITLE = 'Older settings';

export const LEGACY_NOTICE =
  'Existing values keep working. Change an option below to switch to the new formats.';

export const UNSUPPORTED_NOTICE_TITLE = 'Unknown settings version';

export const UNSUPPORTED_NOTICE =
  "These field settings come from an unknown plugin version, so they haven't been changed. The options below show the defaults of the first version of this plugin: change any of them to replace the saved settings.";

export const FORMAT_CHANGE_NOTICE =
  'Existing records keep their current value until an editor converts or replaces it, so make sure your frontend reads both formats meanwhile.';

export function storeChangeNotice(previousStore: string): string {
  return `Existing records point to items in ${previousStore}, so editors have to pick them again from the new store.`;
}

export const CARDINALITY_CHANGE_NOTICE =
  'Records that already hold several items show an error until an editor picks a single one again.';

export const REPAIR_NOTICE =
  'The options below are the closest valid ones: use them, or change any option.';

export const TAGS_IN_COLLECTION_WARNING =
  "Shopify can't apply tag limits inside this collection until the Tag filter is enabled in the Search & Discovery app.";

/** The field editor's and the picker's sentence for the same case. */
export const COLLECTION_MISSING_WARNING = UNRESOLVED_COLLECTION_MESSAGE;

/** One line under the live example: what the frontend receives. */
export function exampleHint(params: FieldParametersV1): string {
  const noun = KIND_NOUNS[params.kind].one;
  switch (params.format) {
    case 'handle':
      return `The handle of the selected ${noun}, as a plain string.`;
    case 'gid':
      return `The Shopify ID of the selected ${noun}, as a plain string.`;
    case 'legacyProductJson':
      return 'The same product JSON as the first version of this plugin, so existing frontends keep working.';
    case 'reference':
      return 'Resolve the IDs with the Storefront API to render live data.';
  }
}

/** The example's `shop` when no store is connected yet. */
export const EXAMPLE_SHOP_PLACEHOLDER = 'your-store.myshopify.com';
