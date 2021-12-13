const productFragment = `
  id
  title
  handle
  description
  onlineStoreUrl
  availableForSale
  productType
  priceRange {
    maxVariantPrice {
      amount
      currencyCode
    }
    minVariantPrice {
      amount
      currencyCode
    }
  }
  images(first: 1) {
    edges {
      node {
        src: transformedSrc(crop: CENTER, maxWidth: 200, maxHeight: 200)
      }
    }
  }
`;

const normalizeProduct = product => (
  Object.assign(
    product,
    {
      imageUrl: product.images.edges[0].node.src,
    },
  )
);

const normalizeProducts = products => (
  products.edges.map(({ node }) => normalizeProduct(node))
);

export default class ShopifyClient {
  constructor({ shopifyDomain, storefrontAccessToken }) {
    this.shopifyDomain = shopifyDomain;
    this.storefrontAccessToken = storefrontAccessToken;
  }

  productsMatching(query) {
    return this.fetch({
      query: `
        query getProducts($query: String) {
          shop {
            products(first: 8, query: $query) {
              edges {
                node {
                  ${productFragment}
                }
              }
            }
          }
        }
      `,
      variables: { query: query || null },
    }).then(result => normalizeProducts(result.shop.products));
  }

  productByHandle(handle) {
    return this.fetch({
      query: `
        query getProduct($handle: String!) {
          shop {
            product: productByHandle(handle: $handle) {
              ${productFragment}
            }
          }
        }
      `,
      variables: { handle },
    }).then(result => normalizeProduct(result.shop.product));
  }

  fetch(body) {
    return fetch(
      `https://${this.shopifyDomain}.myshopify.com/api/graphql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': this.storefrontAccessToken,
        },
        body: JSON.stringify(body),
      },
    )
      .then(res => res.json())
      .then(res => res.data);
  }
}
