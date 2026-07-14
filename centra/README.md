# Centra for DatoCMS

Select Centra products, exact product variants, and buyable SKU/size items directly from DatoCMS records.

Centra remains the source of truth for catalog data. The plugin stores only stable reference IDs in DatoCMS and loads names, media, prices, availability, stock, SKU values, and other product details live from Centra.

## Features

- Product picker restricted to each display's primary variant
- Exact product-variant picker
- SKU/size picker backed by Centra `Item` IDs
- Single and ordered multiple selections
- Product-first search with SKU, size, product-number, variant, and GTIN discovery
- Live product cards with unresolved and availability states
- Light and dark mode support through DatoCMS UI tokens

## Installation

Install **Centra** from the DatoCMS Marketplace, or install the npm package manually:

```text
datocms-plugin-centra
```

The plugin does not request DatoCMS API permissions.

## Configuration

Open the plugin settings and enter:

1. **Storefront API URL** — the complete Centra no-session GraphQL URL.
2. **API token** — a read-only token for that endpoint.

Select **Save and connect**. The plugin validates the credentials by loading one
catalog page before saving. The same Centra connection is used in every DatoCMS
environment.

### Token visibility

The bearer token is stored directly in DatoCMS plugin parameters and is used by the browser through the DatoCMS CORS relay. Masking the input prevents casual disclosure on the settings screen, but it does not turn the token into a server-side secret. Use a dedicated read-only no-session catalog token and restrict access to the DatoCMS project appropriately.

The plugin never uses a Centra shared secret, AMS credentials, or a customer-hosted proxy.

## Adding a Centra field

1. Create a DatoCMS **JSON** field.
2. In the field's **Presentation** settings, choose **Centra**.
3. Choose the reference kind:
   - **Product (primary variant)** — browse one primary DisplayItem per product display.
   - **Exact variant** — browse every DisplayItem/product variant.
   - **SKU / size** — choose a nested Centra Item.
4. Choose **Single** or **Multiple** cardinality.

Changing a populated field to an incompatible kind or changing a multi-value field with several references to single cardinality does not discard or reinterpret data. The editor asks for an explicit clear or replacement.

## Stored value contract

The JSON field contains a versioned document. `null` is the only empty value.

### One product

```json
{
  "version": 1,
  "kind": "primaryProduct",
  "references": [{ "displayItemId": 2752 }]
}
```

### Ordered product variants

```json
{
  "version": 1,
  "kind": "variant",
  "references": [
    { "displayItemId": 2752 },
    { "displayItemId": 2810 }
  ]
}
```

### One SKU/size item

```json
{
  "version": 1,
  "kind": "item",
  "references": [
    {
      "displayItemId": 2752,
      "itemId": "opaque-centra-item-id"
    }
  ]
}
```

The plugin intentionally does not store product names, URIs, images, prices, stock, SKU strings, GTINs, or full product snapshots. Those values can change in Centra and are loaded live.

## Resolving references in a frontend

Fetch DisplayItems by the stored numeric IDs. For item references, locate the exact nested item using the stored opaque `itemId`.

```graphql
query ResolveCentraReferences(
  $displayItemIds: [Int!]
  $market: [Int!]
  $pricelist: [Int!]
  $languageCode: [String!]
) {
  displayItems(
    where: { id: $displayItemIds }
    limit: 100
    market: $market
    pricelist: $pricelist
    languageCode: $languageCode
  ) {
    list {
      id
      name
      productNumber
      isPrimaryVariant
      available
      hasStock
      productVariant {
        id
        name
        number
      }
      items {
        id
        name
        sku
        GTIN
        preorder
        stock {
          available
        }
      }
    }
  }
}
```

Reorder the response using the stored `references` array. Keep a placeholder for missing DisplayItems or Items instead of silently dropping them.

## SKU behavior

Centra exposes buyable sizes as `Item` objects nested below a DisplayItem. A SKU string is display metadata, not a safe identity: stores can contain repeated SKU values, including repeated values within one DisplayItem.

The plugin therefore stores this pair:

```ts
type CentraItemReference = {
  displayItemId: number;
  itemId: string;
};
```

SKU search first asks Centra for matching DisplayItems, then ranks exact nested SKU and GTIN matches in the returned products. Every duplicate match remains selectable. The plugin never scans the entire catalog in the browser.

## Availability and stock

Market, pricelist, language, and Centra allocation rules can change what is visible or available. Product and item stock shown in DatoCMS is the current Storefront API response, not a guarantee that checkout will succeed later.

Missing or inactive references remain visible in the field editor with their stored IDs so editors can remove or replace them deliberately.

## Troubleshooting

### Connection test fails

- Confirm the URL is the complete no-session GraphQL endpoint.
- Confirm the bearer token belongs to the same Storefront API plugin.
- Avoid using the AMS URL as the API endpoint.
- Inspect the HTTP or GraphQL error shown by the plugin; credentials are redacted from messages.

### Prices or translations differ from the Centra backoffice

The plugin uses the market, pricelist, and language defaults exposed by the
configured no-session endpoint. Adjust those defaults in Centra if the catalog
response is not the one editors should browse.

### A primary product now shows a warning

The selected DisplayItem is pinned. If Centra later assigns another primary variant, the plugin warns and leaves the existing reference untouched. Replace it explicitly if the content should follow the new primary choice.

## Development

```bash
npm install
npm run dev
```

Then install a private plugin in DatoCMS with `http://localhost:5173/` as its entry point.

Run all local checks with:

```bash
npm run lint
npm test
npm run build
```

## Centra documentation

- [Storefront API architecture](https://centra.dev/storefront-api/architecture)
- [Catalog product information](https://centra.dev/storefront-api/catalog/product-information)
- [DisplayItem API type](https://centra.dev/storefront-api/api-reference/types/DisplayItem)
- [Item API type](https://centra.dev/storefront-api/api-reference/types/Item)
