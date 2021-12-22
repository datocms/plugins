import { ValidConfig } from '../types';

export type Product = {
  handle: string;
  description: string;
  title: string;
  productType: string;
  onlineStoreUrl: string;
  imageUrl: string;
  priceRange: {
    maxVariantPrice: PriceTypes;
    minVariantPrice: PriceTypes;
  };
  images: {
    edges: [
      {
        node: {
          src: string;
        };
      },
    ];
  };
};

export type PriceTypes = {
  amount: number;
  currencyCode: string;
};

export type Products = {
  edges: [{ node: Product }];
};

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

const normalizeProduct = (product: any): Product => {
  if (!product || typeof product !== 'object') {
    throw new Error('Invalid product');
  }

  return {
    ...product,
    imageUrl: product.images.edges[0].node.src,
  };
};

const normalizeProducts = (products: any): Product[] =>
  products.edges.map((edge: any) => normalizeProduct(edge.node));

export default class ShopifyClient {
  storefrontAccessToken: string;
  shopifyDomain: string;

  constructor({
    storefrontAccessToken,
    shopifyDomain,
  }: Pick<ValidConfig, 'shopifyDomain' | 'storefrontAccessToken'>) {
    this.storefrontAccessToken = storefrontAccessToken;
    this.shopifyDomain = shopifyDomain;
  }

  async productsMatching(query: string) {
    const response = await this.fetch({
      query: `
        query getProducts($query: String) {
          shop {
            products(first: 10, query: $query) {
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
    });

    return normalizeProducts(response.shop.products);
  }

  async productByHandle(handle: string) {
    const response = await this.fetch({
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
    });

    return normalizeProduct(response.shop.product);
  }

  async fetch(requestBody: any) {
    const res = await fetch(
      `https://${this.shopifyDomain}.myshopify.com/api/graphql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': this.storefrontAccessToken,
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (res.status !== 200) {
      throw new Error(`Invalid status code: ${res.status}`);
    }

    const contentType = res.headers.get('content-type');

    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(
        `Invalid content type: ${contentType}`,
      );
    }

    const body = await res.json();

    return body.data;
  }
}
