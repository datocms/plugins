import Client from "./components/client";
export type FirstInstallationParameters = {};
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";

export type ValidParameters = {
  baseEndpoint: string;
  clientId: string;
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
  id: string;
  result: Product;
  status: string;
  attributes: {
    image_url: string;
    name: string;
    code: string;
    description: string;
  };
};

export type StoreTypes = {
  code: string;
  client: Client | null;
};

export type MainStateTypes = {
  baseEndpoint: string;
  clientId: string;
  value: string | null;
};
