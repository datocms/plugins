# DatoCMS Shopify product plugin

A plugin that allows users to search and select Shopify products.

## Configuration

Please specify your Shopify domain and Storefront access token on the plugin global settings:

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/shopify-product/docs/settings.png)

You can either hook this plugin manually to your single-line and JSON fields, or specifying an automatic match rule based on the API key.

If you hook this plugin to a single-line field it will save the product handle.

If you hook it to a JSON field, it will save a JSON containing all the product's info. Like this:

```
{
  "id": "1234567890",
  "title": "My product",
  "handle": "my-product",
  "description": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed pharetra consequat diam. In metus risus, aliquam non massa tempus, gravida commodo orci.",
  "onlineStoreUrl": "https://graphql.myshopify.com/products/my-product",
  "availableForSale": true,
  "productType": "T-Shirts",
  "priceRange": {
    "maxVariantPrice": {
      "amount": "40.0",
      "currencyCode": "CAD"
    },
    "minVariantPrice": {
      "amount": "40.0",
      "currencyCode": "CAD"
    }
  },
  "images": {
    "edges": [
      {
        "node": {
          "src": "https://cdn.shopify.com/s/files/1/1312/0893/products/001_39681e15-ce94-48ca-830f-980b11868856.jpg?v=1491851133",
          "previewSrc": "https://cdn.shopify.com/s/files/1/1312/0893/products/001_39681e15-ce94-48ca-830f-980b11868856_200x200.jpg?v=1491851133"
        }
      }
    ]
  },
  "imageUrl": "https://cdn.shopify.com/s/files/1/1312/0893/products/001_39681e15-ce94-48ca-830f-980b11868856.jpg?v=1491851133",
  "previewImageUrl": "https://cdn.shopify.com/s/files/1/1312/0893/products/001_39681e15-ce94-48ca-830f-980b11868856_200x200.jpg?v=1491851133"
}
```

## Obtain a Shopify API key

To request a Storefront API access token follow [these instructions](https://www.shopify.com/partners/blog/storefront-api-learning-kit).

Remember to give products read permissions.
![Demo](https://raw.githubusercontent.com/datocms/plugins/master/shopify-product/docs/shopify-storefront-key.png)

## Changelog

### 1.0.9

- New selections save full-size `imageUrl` plus `previewImageUrl` for the 200x200 preview. Existing JSON field values are not rewritten; reselect products or update stored JSON to refresh old `_200x200` `imageUrl` values.
