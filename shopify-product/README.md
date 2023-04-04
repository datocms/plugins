# DatoCMS Shopify product plugin

A plugin that allows users to search and select Shopify products.

## Configuration

Please specify your Shopify domain and Storefront access token on the plugin global settings:

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/shopify-product/docs/settings.png)

You can either hook this plugin manually to your single-line and JSON fields, or specifying an automatic match rule based on the API key.

If you hook this plugin to a single-line field it will save the product handle.

If you hook it to a JSON field, it will save a JSON containing all the product's info.

## Obtain a Shopify API key

To request a Storefront API access token follow [these instructions](https://www.shopify.com/partners/blog/storefront-api-learning-kit).

Remember to give products read permissions.
![Demo](https://raw.githubusercontent.com/datocms/plugins/master/shopify-product/docs/shopify-storefront-key.png)
