import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { useEffect, useState } from "react";
import get from "lodash-es/get";
import Value from "./Value";
import Empty from "./Empty";
import Client from "./client";
import { MainStateTypes, onSelectType } from "../types";

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

const stateFromPlugin = ({ ctx }: PropTypes): MainStateTypes => ({
  shopifyDomain: ctx.plugin.attributes.parameters.shopifyDomain as string,
  storefrontAccessToken: ctx.plugin.attributes.parameters
    .storefrontAccessToken as string,
  value: get(ctx.formValues, ctx.fieldPath) as string | null,
});

export default function Main({ ctx }: PropTypes) {
  const [client, setClient] = useState<Client | null>(null);
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    const {
      value: newValue,
      shopifyDomain,
      storefrontAccessToken,
    } = stateFromPlugin({ ctx });

    const newClient = new Client({ shopifyDomain, storefrontAccessToken });

    setValue(newValue);
    setClient(newClient);
  }, [ctx]);

  const handleSelect: onSelectType = ({ product }) => {
    ctx.setFieldValue(ctx.fieldPath, product ? product.handle : "");
  };

  const handleReset = () => {
    ctx.setFieldValue(ctx.fieldPath, "");
  };

  return value ? (
    <Value client={client} value={value} onReset={handleReset} ctx={ctx} />
  ) : (
    <Empty ctx={ctx} onSelect={handleSelect} />
  );
}
