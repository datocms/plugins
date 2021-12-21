import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import Client from "./components/client";

export type FirstInstallationParameters = {};

export type ValidParameters = {
  shopifyDomain: string;
  storefrontAccessToken: string;
};

export type ConfigParameters = FirstInstallationParameters | ValidParameters;

export type EmptyProps = {
  ctx: RenderFieldExtensionCtx;
  onSelect: onSelectType;
};

export type ValueProps = {
  value: string;
  client: Client | null;
  onReset: () => void;
  ctx: RenderFieldExtensionCtx;
};

export type onSelectType = ({ product }: { product: Product | null }) => void;

export type State = {
  searches: Record<string, any>;
  query: string;
  products: Record<string, Product>;
};

export type Product = {
  status: string;
  handle: string;
  result: Product;
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
      }
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

export type StoreTypes = {
  handle: string;
  client: Client | null;
};

export type MainStateTypes = {
  storefrontAccessToken: string;
  shopifyDomain: string;
  value: string | null;
};
