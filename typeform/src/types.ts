import Client from "./components/client";
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";

export type FirstInstallationParameters = {};

export type ValidParameters = {
  apiToken: string;
  corsUrlPrefix: string;
};

export type ConfigParameters = FirstInstallationParameters | ValidParameters;

export type FetchParams = {
  search?: string;
  page_size?: number;
  completed?: "true" | "false";
} | null;

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

export type onSelectType = ({ product }: { product: Form | null }) => void;

export type State = {
  searches: Record<string, any>;
  query: string;
  forms: Record<string, Form>;
  themes: Record<string, Theme>;
  results: Record<string, Result>;
};

export type Form = {
  id: string;
  result: Form;
  status: string;
  theme: { href: string };
};

export type Theme = {
  id: string;
  result: Theme;
  status: string;
};

export type Result = {
  id: string;
  result: Result;
  status: string;
};

export type TypeformIdentityTypes = {
  id: string;
  client: Client | null;
};

export type TypeformQueryTypes = {
  query: string;
  client: Client | null;
};

export type MainStateTypes = {
  corsUrlPrefix: string;
  apiToken: string;
  value: string | null;
};
