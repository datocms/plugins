# Shopify plugin: developer guide

What the Shopify plugin stores in your DatoCMS fields, how to turn those values into live Shopify data in your frontend, and what to know when changing field settings or upgrading from 1.x. For installing and using the plugin, see the [README](../README.md).

## Contents

- [Field formats](#field-formats)
- [Stored value contract](#stored-value-contract)
- [Using the values in your frontend](#using-the-values-in-your-frontend)
- [Connection and request errors](#connection-and-request-errors)
- [Invalid field values](#invalid-field-values)
- [Migrating from 1.x](#migrating-from-1x)
- [Migrating from community Shopify plugins](#migrating-from-community-shopify-plugins)

## Field formats

### Valid combinations

| Field type | Stored value | Editors pick | How many | Display snapshot |
|---|---|---|---|---|
| Single-line string | Handle (1.x default) | Products, collections | One | No |
| Single-line string | Shopify ID | Products, variants, collections | One | No |
| JSON | Reference document (default for new JSON fields) | Products, variants, collections | One or multiple | Optional |
| JSON | Legacy product JSON (1.x default) | Products | One | No |

The field settings only offer valid combinations.

### Choosing a stored value format

| You want to… | Use |
|---|---|
| Pick several items, in order | A JSON field with **Reference document** |
| Pick one variant | A string field with **Shopify ID**, or a JSON field with **Reference document** (which also stores the product's handle for building URLs) |
| Find the DatoCMS record for a product page, such as `/products/[handle]` | A string field with **Handle**. The Content Delivery API can filter string fields by value, but JSON fields only by whether they're set. |
| Keep content working when a merchant renames a handle | **Shopify ID** or **Reference document**. Both resolve by ID, and the editor offers to update a stored handle that changed. |
| Keep a frontend built for 1.x working | Leave the field on **Handle** or **Legacy product JSON** |

Avoid **Legacy product JSON** for new fields. It holds one product, its data is a copy that goes stale, and it exists only for compatibility.

### Changing a field that already has values

Changing a field's settings never rewrites stored values. Each record keeps its value until an editor acts on it:

- A value in another format the plugin knows (for example, 1.x product JSON in a field now set to **Reference document**, or a handle in a string field now set to **Shopify ID**) still shows normally, with a notice such as "Saved as a Shopify handle. This field now saves a Shopify ID." and a **Convert to new format** action that re-saves that one value in the new format.
- A value that can't fit the new settings (for example, several items in a field now set to one, or products in a field now set to variants) shows as an [invalid value](#invalid-field-values).

When you change a saved field, its settings warn you next to the option you changed:

- **Editors pick** or **Stored value**: "Existing records keep their current value until an editor converts or replaces it. Make sure your frontend reads both formats during the transition." See [Reading old and new formats during a transition](#reading-old-and-new-formats-during-a-transition).
- **How many**, from **Multiple** to **One**: "Records that already hold several items show an error until an editor picks a single one again."
- **Store**: existing records point to items in the previous store, and editors have to pick them again from the new one.

## Stored value contract

This is the reference for frontend developers. The plugin writes exactly these shapes. The examples are real values from DatoCMS's demo store, built with the plugin's own serializer.

| Format | Field type | Example |
|---|---|---|
| [Handle](#handle) | Single-line string | `the-complete-snowboard` |
| [Shopify ID](#shopify-id) | Single-line string | `gid://shopify/ProductVariant/50698337681754` |
| [Reference document](#reference-document) | JSON | `{ "version": 1, "shop": "…", "kind": "product", "references": [ … ] }` |
| [Legacy product JSON](#legacy-product-json) | JSON | `{ "id": "gid://shopify/Product/…", "title": "…", "handle": "…", … }` |

An empty field is `null`. Treat an empty string in a string field as empty too.

### Handle

A string field set to **Handle** stores the product or collection handle as plain text, exactly as 1.x did:

```text
the-complete-snowboard
```

A collection field stores the collection's handle, such as `frontpage`.

- A handle identifies an item within one store, and merchants can change it. When that happens, the old handle stops resolving: editors see the item as not visible to the storefront and need to pick it again.
- Variants can't be stored as handles.
- A string field may also hold a Shopify ID written by another plugin or tool, including old base64-encoded IDs. The plugin reads those, and your frontend should too. See [Reading old and new formats during a transition](#reading-old-and-new-formats-during-a-transition).

### Shopify ID

A string field set to **Shopify ID** stores the item's global ID (GID). One of these, depending on what the field picks:

```text
gid://shopify/Product/10080752009562
gid://shopify/ProductVariant/50698337681754
gid://shopify/Collection/645260968282
```

GIDs never change. The Storefront API resolves them with `node(id:)` or `nodes(ids:)`, and a variant gives you its product through `ProductVariant.product`.

### Reference document

A JSON field set to **Reference document** stores a versioned document. `null` is the only empty value: a document always has at least one reference.

One product:

```json
{
  "version": 1,
  "shop": "datocms-demo.myshopify.com",
  "kind": "product",
  "references": [
    {
      "id": "gid://shopify/Product/10080752009562",
      "handle": "the-complete-snowboard"
    }
  ]
}
```

Several products, in the order the editor arranged them:

```json
{
  "version": 1,
  "shop": "datocms-demo.myshopify.com",
  "kind": "product",
  "references": [
    {
      "id": "gid://shopify/Product/10080752009562",
      "handle": "the-complete-snowboard"
    },
    {
      "id": "gid://shopify/Product/10080752337242",
      "handle": "the-collection-snowboard-liquid"
    }
  ]
}
```

Variants carry their product's ID and handle, so you can build the product URL without another request:

```json
{
  "version": 1,
  "shop": "datocms-demo.myshopify.com",
  "kind": "variant",
  "references": [
    {
      "id": "gid://shopify/ProductVariant/50698337681754",
      "productId": "gid://shopify/Product/10080752009562",
      "productHandle": "the-complete-snowboard"
    },
    {
      "id": "gid://shopify/ProductVariant/50698338337114",
      "productId": "gid://shopify/Product/10080752271706",
      "productHandle": "the-multi-managed-snowboard"
    }
  ]
}
```

Collections:

```json
{
  "version": 1,
  "shop": "datocms-demo.myshopify.com",
  "kind": "collection",
  "references": [
    {
      "id": "gid://shopify/Collection/645260968282",
      "handle": "frontpage"
    },
    {
      "id": "gid://shopify/Collection/645261132122",
      "handle": "hydrogen"
    }
  ]
}
```

The rules:

- The document has exactly four keys: `version`, `shop`, `kind` and `references`.
- `version` is `1`. A future incompatible shape would use a new version number, so reject versions you don't know.
- `shop` is the store's `.myshopify.com` domain. In a project with several stores, it tells you which store to query.
- `kind` is `product`, `variant` or `collection`, and it's the same for every reference.
- `references` keeps the editor's order, has no duplicates, and has exactly one item in single-value fields.
- Product and collection references have exactly `id` and `handle`. Variant references have exactly `id`, `productId` and `productHandle`. Any reference can also have a [`snapshot`](#display-snapshot).
- IDs are always plain GIDs such as `gid://shopify/Product/123`: never base64, never with a query string.
- Handles are the item's handle in the shop's primary language when the editor picked it, even when the editor browsed in another language (Shopify translates handles, and a translated handle only resolves in that language). If a merchant renames a product, the stored handle is stale until an editor clicks **Update**, but the ID keeps resolving.

As TypeScript:

```ts
type Money = { amount: string; currencyCode: string };

type ReferenceSnapshot = {
  title: string;
  imageUrl?: string;
  price?: Money;
  sku?: string;
  capturedAt: string;
};

type ProductReference = {
  id: string;
  handle: string;
  snapshot?: ReferenceSnapshot;
};

type VariantReference = {
  id: string;
  productId: string;
  productHandle: string;
  snapshot?: ReferenceSnapshot;
};

type CollectionReference = {
  id: string;
  handle: string;
  snapshot?: ReferenceSnapshot;
};

type ShopifyReference = ProductReference | VariantReference | CollectionReference;

type ShopifyReferenceDocument =
  | { version: 1; shop: string; kind: 'product'; references: ProductReference[] }
  | { version: 1; shop: string; kind: 'variant'; references: VariantReference[] }
  | { version: 1; shop: string; kind: 'collection'; references: CollectionReference[] };
```

### Display snapshot

With **Include a display snapshot?** on, each reference also gets the title, image and price captured when the editor picked it:

```json
{
  "version": 1,
  "shop": "datocms-demo.myshopify.com",
  "kind": "product",
  "references": [
    {
      "id": "gid://shopify/Product/10080752009562",
      "handle": "the-complete-snowboard",
      "snapshot": {
        "title": "The Complete Snowboard",
        "imageUrl": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1741717811",
        "price": {
          "amount": "699.95",
          "currencyCode": "EUR"
        },
        "capturedAt": "2026-10-03T12:00:00Z"
      }
    }
  ]
}
```

Variants add the SKU when they have one. The second variant below belongs to a product without options, so its title is just the product title:

```json
{
  "version": 1,
  "shop": "datocms-demo.myshopify.com",
  "kind": "variant",
  "references": [
    {
      "id": "gid://shopify/ProductVariant/50698337681754",
      "productId": "gid://shopify/Product/10080752009562",
      "productHandle": "the-complete-snowboard",
      "snapshot": {
        "title": "The Complete Snowboard — Ice",
        "imageUrl": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1741717811",
        "price": {
          "amount": "699.95",
          "currencyCode": "EUR"
        },
        "capturedAt": "2026-10-03T12:00:00Z"
      }
    },
    {
      "id": "gid://shopify/ProductVariant/50698338337114",
      "productId": "gid://shopify/Product/10080752271706",
      "productHandle": "the-multi-managed-snowboard",
      "snapshot": {
        "title": "The Multi-managed Snowboard",
        "imageUrl": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_9129b69a-0c7b-4f66-b6cf-c4222f18028a.jpg?v=1741717812",
        "price": {
          "amount": "629.95",
          "currencyCode": "EUR"
        },
        "sku": "sku-managed-1",
        "capturedAt": "2026-10-03T12:00:00Z"
      }
    }
  ]
}
```

| Key | Products | Variants | Collections |
|---|---|---|---|
| `title` | Product title | `Product title — option values`, or the product title for a product without options | Collection title |
| `imageUrl` | Featured image, full size | Variant image (or the product's featured image), full size | Collection image, full size |
| `price` | Lowest variant price | Variant price | Never |
| `sku` | Never | When the variant has a SKU | Never |
| `capturedAt` | When the editor added, replaced or converted the item (ISO 8601) | Same | Same |

`imageUrl` is left out when the item has no image. It's the original image on Shopify's CDN, so size it yourself: Shopify resizes CDN images with a `width` parameter, such as `&width=400`. Titles and prices are in the market the picker showed, normally the store's default market.

Snapshots are display hints, not data. They're captured when an editor adds, replaces or converts the item and aren't kept in sync with Shopify, which stays the source of truth for titles, prices and images. Items already in the field keep their snapshot when editors add, remove or reorder others, even after the setting is turned off. Use snapshots for previews, placeholders, and a fallback when Shopify doesn't return an item.

### Legacy product JSON

A JSON field set to **Legacy product JSON**, which includes every 1.x JSON field, stores a copy of one product in exactly the shape 1.x wrote. Shown formatted here:

```json
{
  "id": "gid://shopify/Product/10080752009562",
  "title": "The Complete Snowboard",
  "handle": "the-complete-snowboard",
  "description": "This PREMIUM snowboard is so SUPERDUPER awesome!",
  "onlineStoreUrl": null,
  "availableForSale": true,
  "productType": "snowboard",
  "priceRange": {
    "maxVariantPrice": {
      "amount": "699.95",
      "currencyCode": "EUR"
    },
    "minVariantPrice": {
      "amount": "699.95",
      "currencyCode": "EUR"
    }
  },
  "images": {
    "edges": [
      {
        "node": {
          "src": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1741717811",
          "previewSrc": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d_200x200.jpg?v=1741717811"
        }
      }
    ]
  },
  "imageUrl": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d.jpg?v=1741717811",
  "previewImageUrl": "https://cdn.shopify.com/s/files/1/0940/1522/6202/files/Main_589fc064-24a2-4236-9eaf-13b2bd35d21d_200x200.jpg?v=1741717811"
}
```

- `id` is the product's GID. The 1.x README showed `"id": "1234567890"`, which was wrong. Values saved while Shopify still returned base64-encoded IDs (Storefront API versions before 2022-04) hold a base64 GID instead, such as `Z2lkOi8vc2hvcGlmeS9Qcm9kdWN0LzEwMDgwNzUyMDA5NTYy`, which decodes to `gid://shopify/Product/10080752009562`.
- Amounts are decimal strings, exactly as Shopify returns them.
- `onlineStoreUrl` is `null` when the product has no Online Store page, which is common for headless stores.
- `imageUrl` is the full-size image and `previewImageUrl` a 200×200 version. Values saved before 1.0.10 have no `previewImageUrl` and no `previewSrc`, and their `imageUrl` and `src` are 200×200 images. Values saved before 1.0.1 have `_crop_center` image URLs.
- Titles and prices are in the shop's primary language and currency, as 1.x wrote them: the plugin reads and writes this format without a market, whatever the store's default market or the record's language.
- The data is a copy from when the product was picked or last refreshed. The plugin never updates it on its own; editors see "Shopify data changed since this was saved" and can click **Refresh saved data**.

### How each API returns the value

| Where you read it | String fields | JSON fields |
|---|---|---|
| Content Delivery API (GraphQL) | A string | Parsed JSON: an object, or `null` |
| Content Management API, webhooks, plugin SDK | A string | JSON text, or `null` |

DatoCMS re-formats JSON fields when it saves them, so compare parsed values, never raw text. In the Content Delivery API, JSON fields can only be filtered by whether they're set; to look records up by product, use a string field.

## Using the values in your frontend

The examples below use plain `fetch` and TypeScript, so they work in any framework and runtime. They assume a `home_page` model with a `featured_products` JSON field set to **Reference document**. Every Storefront API query here was run against version `2026-10` on DatoCMS's demo store.

### 1. Query the field from DatoCMS

```graphql
query HomePage {
  homePage {
    featuredProducts
  }
}
```

The Content Delivery API returns JSON fields already parsed:

```json
{
  "data": {
    "homePage": {
      "featuredProducts": {
        "version": 1,
        "shop": "datocms-demo.myshopify.com",
        "kind": "product",
        "references": [
          {
            "id": "gid://shopify/Product/10080752009562",
            "handle": "the-complete-snowboard"
          },
          {
            "id": "gid://shopify/Product/10080752337242",
            "handle": "the-collection-snowboard-liquid"
          }
        ]
      }
    }
  }
}
```

A small helper for the Content Delivery API:

```ts
type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export async function datocmsQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<T> {
  const response = await fetch('https://graphql.datocms.com/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as GraphqlResponse<T>;
  if (!response.ok || body.errors?.length || !body.data) {
    const message = body.errors?.map((error) => error.message).join('; ');
    throw new Error(`DatoCMS request failed (HTTP ${response.status}): ${message ?? 'no data'}`);
  }
  return body.data;
}

const { homePage } = await datocmsQuery<{ homePage: { featuredProducts: unknown } }>(
  'query HomePage { homePage { featuredProducts } }',
  {},
  process.env.DATOCMS_READONLY_TOKEN ?? '',
);
```

### 2. Parse the reference document

This accepts the value as the Content Delivery API returns it (already parsed) and as the Content Management API, webhooks and plugins return it (a JSON string). It uses the types from the [Reference document](#reference-document) section.

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseShopifyField(value: unknown): ShopifyReferenceDocument | null {
  const json: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (json === null || json === undefined) return null;

  if (!isRecord(json) || json.version !== 1 || !Array.isArray(json.references)) {
    throw new Error('Expected a version 1 Shopify reference document');
  }
  return json as ShopifyReferenceDocument;
}
```

### 3. Load live data from Shopify

Resolve every reference in one request with `nodes(ids:)`. Use a token from the same Headless storefront as the plugin, so your frontend sees the same products editors picked from. On a server you can use that storefront's private token instead, sent in the `Shopify-Storefront-Private-Token` header.

```ts
const SHOPIFY_DOMAIN = 'datocms-demo.myshopify.com'; // your-shop.myshopify.com
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN ?? '';
const SHOPIFY_API_VERSION = '2026-10';

export async function storefrontQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(
    `https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const body = (await response.json()) as GraphqlResponse<T>;
  if (!response.ok || body.errors?.length || !body.data) {
    const message = body.errors?.map((error) => error.message).join('; ');
    throw new Error(`Shopify request failed (HTTP ${response.status}): ${message ?? 'no data'}`);
  }
  return body.data;
}

const RESOLVE_REFERENCES_QUERY = /* GraphQL */ `
  query ResolveShopifyReferences(
    $ids: [ID!]!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        handle
        title
        onlineStoreUrl
        availableForSale
        featuredImage { url altText width height }
        priceRange {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
      }
      ... on ProductVariant {
        id
        title
        sku
        availableForSale
        selectedOptions { name value }
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        image { url altText width height }
        product {
          id
          handle
          title
          onlineStoreUrl
          featuredImage { url altText width height }
        }
      }
      ... on Collection {
        id
        handle
        title
        onlineStoreUrl
        image { url altText width height }
      }
    }
  }
`;

type ShopifyImage = {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
};

type ProductNode = {
  __typename: 'Product';
  id: string;
  handle: string;
  title: string;
  onlineStoreUrl: string | null;
  availableForSale: boolean;
  featuredImage: ShopifyImage | null;
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
};

type VariantNode = {
  __typename: 'ProductVariant';
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  price: Money;
  compareAtPrice: Money | null;
  image: ShopifyImage | null;
  product: {
    id: string;
    handle: string;
    title: string;
    onlineStoreUrl: string | null;
    featuredImage: ShopifyImage | null;
  };
};

type CollectionNode = {
  __typename: 'Collection';
  id: string;
  handle: string;
  title: string;
  onlineStoreUrl: string | null;
  image: ShopifyImage | null;
};

export type ShopifyNode = ProductNode | VariantNode | CollectionNode;

type MarketContext = { country?: string; language?: string };

/** Same order as `ids`, with null where the storefront can't see the item. */
export async function fetchShopifyNodes(
  ids: string[],
  context: MarketContext = {},
): Promise<Array<ShopifyNode | null>> {
  const nodes: Array<ShopifyNode | null> = [];
  // nodes(ids:) takes at most 250 IDs per request.
  for (let start = 0; start < ids.length; start += 250) {
    const data = await storefrontQuery<{ nodes: Array<ShopifyNode | null> }>(
      RESOLVE_REFERENCES_QUERY,
      {
        ids: ids.slice(start, start + 250),
        country: context.country ?? null,
        language: context.language ?? null,
      },
    );
    nodes.push(...data.nodes);
  }
  return nodes;
}

export type ResolvedReference = {
  reference: ShopifyReference;
  /** null: unpublished from the storefront, archived or deleted. */
  node: ShopifyNode | null;
};

export async function resolveShopifyField(
  value: unknown,
  context: MarketContext = {},
): Promise<ResolvedReference[]> {
  const document = parseShopifyField(value);
  if (!document) return [];

  const references: ShopifyReference[] = document.references;
  const nodes = await fetchShopifyNodes(
    references.map(({ id }) => id),
    context,
  );

  // Shopify answers in input order, with null in place of anything the
  // storefront can't see, so mapping by index keeps the editor's order.
  return references.map((reference, index) => ({
    reference,
    node: nodes[index] ?? null,
  }));
}
```

What to rely on:

- `nodes(ids:)` returns results in the order you asked for them, and `null` in place of any ID the storefront can't see: unpublished from this storefront, archived, deleted, or not sold in the requested market. It doesn't fail the request.
- It accepts up to 250 IDs per request; more fails with `MAX_INPUT_SIZE_EXCEEDED`.
- IDs of different kinds can be mixed in one request.
- Fields that need optional permissions (such as `quantityAvailable`, which needs **Read product inventory**) come back as `null` with an `ACCESS_DENIED` error when the token lacks them. Only request what your token allows.

### 4. Render, keeping order and unavailable items

```ts
export function formatMoney(money: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currencyCode,
  }).format(Number(money.amount));
}

/** `gid://shopify/ProductVariant/50698337681754` → `50698337681754` */
export function numericId(gid: string): string {
  return gid.slice(gid.lastIndexOf('/') + 1);
}

type Card = {
  title: string;
  image: ShopifyImage | null;
  price: Money | null;
  path: string;
};

export function cardFor(node: ShopifyNode): Card {
  switch (node.__typename) {
    case 'Product':
      return {
        title: node.title,
        image: node.featuredImage,
        price: node.priceRange.minVariantPrice,
        path: `/products/${node.handle}`,
      };
    case 'ProductVariant':
      return {
        // A product without options has one variant called "Default Title".
        title:
          node.title === 'Default Title'
            ? node.product.title
            : `${node.product.title} — ${node.title}`,
        image: node.image ?? node.product.featuredImage,
        price: node.price,
        path: `/products/${node.product.handle}?variant=${numericId(node.id)}`,
      };
    case 'Collection':
      return {
        title: node.title,
        image: node.image,
        price: null,
        path: `/collections/${node.handle}`,
      };
  }
}

const items = await resolveShopifyField(homePage.featuredProducts);

const cards = items.map(({ reference, node }) =>
  node
    ? { available: true as const, ...cardFor(node) }
    : {
        // Unpublished, archived or deleted in Shopify. Keep the slot so the
        // layout matches what editors arranged, or drop it on purpose. The
        // snapshot is only there if the field stores one.
        available: false as const,
        title: reference.snapshot?.title ?? null,
      },
);
```

Variant links use `?variant=` with the variant's numeric ID, the URL format of Shopify's Online Store themes. You can build one straight from a stored reference, without asking Shopify:

```ts
export function variantPath(reference: VariantReference): string {
  return `/products/${reference.productHandle}?variant=${numericId(reference.id)}`;
}
```

Hydrogen storefronts select variants with option parameters instead (`?Color=Ice`):

```ts
export function hydrogenVariantPath(node: VariantNode): string {
  const params = new URLSearchParams(
    node.selectedOptions.map(({ name, value }) => [name, value]),
  );
  return `/products/${node.product.handle}?${params}`;
}
```

### Markets and languages

Pass a country and a language to get prices, currencies and translations for a market. Shopify applies them through `@inContext`:

```ts
const itemsForMexico = await resolveShopifyField(homePage.featuredProducts, {
  country: 'MX',
  language: 'ES',
});
```

On the demo store, `MX` returns prices in MXN instead of EUR. A language the store doesn't offer silently falls back to the default; `extensions.context` in Shopify's response shows the country and language it applied.

### Handle fields with Hydrogen

Hydrogen routes are keyed by handle (`/products/$handle`), so a string field set to **Handle** lets a product page find its DatoCMS content with a single filter. This example assumes a `product_page` model with a `shopify_product` string field set to **Handle**, plus `headline` and `body` fields. It reuses `datocmsQuery` from step 1.

```tsx
// app/routes/products.$handle.tsx
import { useLoaderData } from 'react-router';
import type { Route } from './+types/products.$handle';
import { datocmsQuery } from '~/lib/datocms';

const PRODUCT_QUERY = `#graphql
  query ProductByHandle(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      id
      handle
      title
      descriptionHtml
      onlineStoreUrl
      featuredImage { url altText width height }
      priceRange {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
    }
  }
` as const;

const PRODUCT_CONTENT_QUERY = `
  query ProductContent($handle: String) {
    productPage(filter: { shopifyProduct: { eq: $handle } }) {
      headline
      body(markdown: true)
    }
  }
`;

type ProductContent = {
  productPage: { headline: string | null; body: string | null } | null;
};

export async function loader({ params, context }: Route.LoaderArgs) {
  const { handle } = params;

  const [{ product }, content] = await Promise.all([
    // Hydrogen fills $country and $language from your i18n settings.
    context.storefront.query(PRODUCT_QUERY, { variables: { handle } }),
    datocmsQuery<ProductContent>(
      PRODUCT_CONTENT_QUERY,
      { handle },
      context.env.DATOCMS_READONLY_TOKEN,
    ),
  ]);

  if (!product) throw new Response('Not found', { status: 404 });
  return { product, content: content.productPage };
}

export default function Product() {
  const { product, content } = useLoaderData<typeof loader>();
  return (
    <article>
      <h1>{content?.headline ?? product.title}</h1>
      {content?.body ? (
        <div dangerouslySetInnerHTML={{ __html: content.body }} />
      ) : (
        <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
      )}
    </article>
  );
}
```

Add `DATOCMS_READONLY_TOKEN` to your environment variables (and to the `Env` type in `env.d.ts`). The plugin stores the handle in the shop's primary language, and Shopify handles are always lowercase, so the `eq` filter matches routes that use primary-language handles. If your storefront translates handles, a localized route carries the translated handle and the filter finds nothing: take `product.id` from the query above, fetch its primary handle with a query that has no `@inContext` (`product(id: $id) { handle }`) and filter by that, or use a **Shopify ID** field and filter by `product.id`. For a collection handle field, use `collection(handle:)` the same way.

### Shopify ID fields

A string field set to **Shopify ID** resolves with the same helper:

```ts
export async function resolveShopifyId(
  value: string | null,
  context: MarketContext = {},
): Promise<ShopifyNode | null> {
  if (!value) return null;
  const [node] = await fetchShopifyNodes([value], context);
  return node ?? null;
}
```

### Reading old and new formats during a transition

When you move an existing field to a new format, each record keeps its old value until an editor converts it. During that time your frontend sees both. These helpers read every format the plugin has ever stored: a handle, a Shopify ID (plain or base64), the 1.x product JSON and a reference document.

```ts
type ShopifyKind = 'product' | 'variant' | 'collection';

export type ShopifyItem = {
  kind: ShopifyKind;
  /** The GID, or null when only a handle is stored. */
  id: string | null;
  /** Product or collection handle (for variants, the product's handle). */
  handle: string | null;
};

const KIND_BY_GID_TYPE: Record<string, ShopifyKind> = {
  Product: 'product',
  ProductVariant: 'variant',
  Collection: 'collection',
};

/** A GID from a plain GID or from the base64 IDs Shopify used before 2022. */
function toGid(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (value.startsWith('gid://shopify/')) return value;
  try {
    const decoded = atob(value);
    return decoded.startsWith('gid://shopify/') ? decoded : null;
  } catch {
    return null;
  }
}

function kindOfGid(gid: string): ShopifyKind | null {
  const type = gid.split('/')[3] ?? '';
  return KIND_BY_GID_TYPE[type] ?? null;
}

/**
 * Reads any value the plugin has stored. `handleKind` says what a plain
 * handle names in this field.
 */
export function readShopifyValue(
  value: unknown,
  handleKind: 'product' | 'collection' = 'product',
): ShopifyItem[] {
  if (value === null || value === undefined || value === '') return [];

  // String fields: a Shopify ID (2.0) or a handle (1.x).
  if (typeof value === 'string' && !value.trimStart().startsWith('{')) {
    const gid = toGid(value);
    const kind = gid ? kindOfGid(gid) : null;
    if (gid && kind) return [{ kind, id: gid, handle: null }];
    return [{ kind: handleKind, id: null, handle: value }];
  }

  // JSON fields: parsed by the Content Delivery API, a string elsewhere.
  const json: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!isRecord(json)) return [];

  // 2.0 reference document.
  if ('version' in json) {
    const document = parseShopifyField(json);
    if (!document) return [];
    if (document.kind === 'variant') {
      return document.references.map((reference) => ({
        kind: 'variant',
        id: reference.id,
        handle: reference.productHandle,
      }));
    }
    return document.references.map((reference) => ({
      kind: document.kind,
      id: reference.id,
      handle: reference.handle,
    }));
  }

  // 1.x product JSON.
  return [
    {
      kind: 'product',
      id: toGid(json.id),
      handle: typeof json.handle === 'string' ? json.handle : null,
    },
  ];
}
```

Then resolve items with an ID through `nodes(ids:)`, and handle-only items (1.x string fields) by looking up their ID first:

```ts
const IDS_BY_HANDLE_QUERY = /* GraphQL */ `
  query ShopifyIdsByHandle($handle: String!) {
    product(handle: $handle) { id }
    collection(handle: $handle) { id }
  }
`;

async function idForHandle(item: ShopifyItem): Promise<string | null> {
  if (!item.handle) return null;
  const data = await storefrontQuery<{
    product: { id: string } | null;
    collection: { id: string } | null;
  }>(IDS_BY_HANDLE_QUERY, { handle: item.handle });
  return (item.kind === 'collection' ? data.collection?.id : data.product?.id) ?? null;
}

export async function resolveAnyShopifyValue(
  value: unknown,
  handleKind: 'product' | 'collection' = 'product',
  context: MarketContext = {},
): Promise<Array<{ item: ShopifyItem; node: ShopifyNode | null }>> {
  const items = readShopifyValue(value, handleKind);
  const ids = await Promise.all(items.map((item) => item.id ?? idForHandle(item)));

  const knownIds = ids.filter((id): id is string => id !== null);
  const nodes = await fetchShopifyNodes(knownIds, context);
  const nodeById = new Map(knownIds.map((id, index) => [id, nodes[index] ?? null]));

  return items.map((item, index) => ({
    item,
    node: nodeById.get(ids[index] ?? '') ?? null,
  }));
}
```

The Storefront API still accepts base64 IDs, but it always returns plain GIDs, so decode stored IDs (as `toGid` does) before matching results by ID. If your frontend renders the 1.x product JSON directly (`title`, `imageUrl`, `priceRange`), it can keep doing that for legacy values: 2.0 writes the same keys.

## Connection and request errors

The plugin shows a specific message for each failure. Messages never include your token.

| Code | What the plugin says | Cause | Fix |
|---|---|---|---|
| `unauthorized` | Shopify rejected the Storefront access token. Update it in the plugin settings. | HTTP 401: the token is wrong or revoked, or belongs to a deleted storefront. | Copy the **Public access token** again from Headless → your storefront, paste it, and click **Save settings**. |
| `forbidden` | This token isn't allowed to read products. In Shopify → Headless → Storefront API permissions, enable "Read products, variants, and collections". | HTTP 403, or Shopify denied a field the plugin needs. | Enable the permission and save it in Shopify, then click **Re-check** in the plugin settings. |
| `shop-not-found` | No Shopify store found at {shop}. | HTTP 404: there's no store at that domain (a typo, or the store was closed). | Use the `.myshopify.com` domain from Shopify admin → **Settings → Domains**. |
| `store-locked` | This store is password-protected, so the plugin needs a Storefront access token. | HTTP 400 "Online Store channel is locked." on a connection without a token. | Switch off **Connect without a token?** and add a token. |
| `shop-unavailable` | This Shopify store is frozen or locked. | HTTP 402 or 423: the store is frozen (often for unpaid bills) or locked by Shopify. | Resolve it in the Shopify admin or with Shopify support. |
| `security-rejection` | Shopify temporarily blocked these requests. Wait a minute and try again. | HTTP 430: Shopify's bot protection flagged the traffic. | Wait and try again. If it keeps happening, try another network or turn off your VPN. |
| `throttled` | Shopify is rate-limiting requests. Try again shortly. | GraphQL `THROTTLED` or HTTP 429. The plugin already retried 3 times, waiting longer each time. | Wait a moment and try again. |
| `graphql` | Shopify's own error message, or "Shopify returned an error." | Shopify rejected the request. | Read the message. If it persists, [open an issue](https://github.com/datocms/plugins/issues) with it. |
| `network` | Couldn't reach Shopify. Check your connection or ad-blocker. | You're offline, or a browser extension, firewall or proxy blocked `*.myshopify.com`. | Allow `*.myshopify.com` and try again. |
| `invalid-response` | Shopify returned an unexpected response. Try again shortly. | Shopify answered with something other than GraphQL, usually during an incident. | Try again, and check [Shopify Status](https://www.shopifystatus.com). |

Where you see them:

- **Plugin settings:** the store's box says **Couldn't connect to Shopify**, followed by the message, with **Try again**. A rejected token reads "Shopify rejected this token. Check that it's the "Public access token" of a Headless storefront in this store." instead. When a save fails this way, the form says "Couldn't connect to Shopify. Fix the connection above, or save anyway." and the store offers **Save anyway**.
- **Field editor:** a callout such as "Couldn't load the products", followed by the message. For `unauthorized`, `forbidden`, `shop-not-found` and `store-locked`, which only the plugin settings can fix, roles that can edit the schema get **Open plugin settings**, and other roles read "Ask an administrator to check the Shopify connection." after the cause. Every other error offers **Try again**.
- **Picker:** a callout such as "Couldn't load the products", followed by the message and **Try again**.

## Invalid field values

When a stored value can't be read with the field's settings, the field shows an error titled "Couldn't read the saved value" ("Saved for another Shopify store" or "Saved by a newer plugin version" for those two cases), the reason below, and the value exactly as saved, with a **Clear value** action. A value saved for another store also offers **Pick again**, which picks from the field's store and replaces it. Nothing changes until an editor acts. To keep the value, restore the setting it was saved with, or rewrite it through the Content Management API following the [stored value contract](#stored-value-contract).

| Code | What the plugin says | Typical cause |
|---|---|---|
| `invalid-json` | The saved value isn't valid JSON. | The value was edited by hand or by a script. |
| `invalid-shape` | The saved value isn't in a format this field recognizes. | Another plugin or a script wrote it, or a reference document has extra or missing keys. |
| `unsupported-version` | The saved value was written by a newer version of this plugin. Update the plugin to edit it. | A newer plugin version wrote it. |
| `kind-mismatch` | The saved value holds a different kind of Shopify item than this field picks. | The field's **Editors pick** setting changed. |
| `cardinality-mismatch` | The saved value holds several Shopify items, but this field takes only one. | **How many** changed from multiple to one. |
| `shop-mismatch` | The saved value points to a different Shopify store than the one this field uses. | The field's store changed, or the value was picked from the demo store. |
| `duplicate-reference` | The saved value lists the same Shopify item more than once. | A script wrote it. |

## Migrating from 1.x

### What happens when you update

- **Your content doesn't change.** 1.x fields have no field settings, so 2.0 gives them the 1.x defaults: string fields keep storing the product handle, and JSON fields keep storing the 1.x product JSON.
- **Settings move to the 2.0 format** the first time someone who can edit the schema opens the project: your shop is saved as `your-shop.myshopify.com`, the plugin checks which optional permissions your token has (tags and inventory), and fields saved by very old plugin versions are pointed at the current field editor. Editors without schema permissions can work normally before that happens. If the permission check can't reach Shopify, the plugin settings run it again when you open them, and **Save settings** keeps the result.
- **Your token keeps working.** Storefront tokens from custom apps created before January 1, 2026 are still accepted. For a new token, use the [Headless channel](../README.md#connect-your-shopify-store).
- **Requests use Storefront API `2026-10`** instead of the unversioned endpoint. Product data and the legacy JSON shape are the same.
- **The old browser cache is deleted.** 1.x kept one cache for every project and store, keyed by handle, which could show a product from another store.
- **Auto-applied fields stay as they are.** Fields matched by **Auto-apply to fields whose API key matches** keep the 1.x defaults. A matching field you set up with the plugin in its **Presentation** tab keeps its own settings instead.
- **Editors get the new picker and field rows.** Legacy JSON fields now resolve by product ID first and fall back to the handle, so a renamed handle no longer breaks them. When the saved copy is out of date, editors see "Shopify data changed since this was saved" and can click **Refresh saved data**. The legacy JSON is still read and written without a market, so its titles and prices stay in the shop's primary language and currency.

### Moving a field to a new format

1. Update your frontend to read both the old and the new format (see [Reading old and new formats during a transition](#reading-old-and-new-formats-during-a-transition)), and deploy it.
2. Change the field's settings, for example from **Legacy product JSON** to **Reference document**, or from **Handle** to **Shopify ID**.
3. Records keep their old value and keep working. To convert one, open it, click **Convert to new format** on the field, and save the record.
4. When every record is converted, remove the code that reads the old format.

There's no bulk conversion in 2.0. With many records, you can write a Content Management API script that resolves each old value and writes the new one following the [stored value contract](#stored-value-contract).

To move from a handle in a string field to a reference document, add a new JSON field, fill it, and then remove the old field.

### Reading 1.x values correctly

- **`id` in the legacy product JSON is a GID**, such as `gid://shopify/Product/10080752009562`, not the number the 1.x README showed (`"id": "1234567890"` was wrong). Very old values hold a base64-encoded GID: `atob(id)` turns it into the plain GID.
- **Old images may be small.** Values saved before 1.0.10 have only a 200×200 `imageUrl`, with no `previewImageUrl` or `previewSrc`, so fall back to `imageUrl` when those are missing. Values saved before 1.0.1 have `_crop_center` image URLs.
- **Handles can go stale.** If a merchant renames a product, a handle field stops resolving until an editor picks the product again. For references that survive renames, move the field to **Shopify ID**.

## Migrating from community Shopify plugins

There's no automatic migration, because community plugins store their own formats.

- If the old plugin stored a product handle, a collection handle or a Shopify ID (plain or base64) in a **string** field, switch the field's editor to **Shopify** and choose matching settings. The plugin reads those values as they are.
- Otherwise, recreate the field:
  1. Add a new field that uses this plugin, with the settings you need.
  2. Pick the items again in each record, or copy them over with a Content Management API script that writes the [stored value contract](#stored-value-contract).
  3. Update your frontend to read the new field, then remove the old field and uninstall the old plugin.
