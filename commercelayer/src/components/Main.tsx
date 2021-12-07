import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { useEffect, useState } from "react";
import get from "lodash-es/get";
import store from "./store";
import Value from "./Value";
import Empty from "./Empty";
import Client from "./client";
import { MainStateTypes } from "../types";
import { Provider } from "react-redux";

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

const stateFromPlugin = ({ ctx }: PropTypes): MainStateTypes => ({
  clientId: ctx.parameters.clientId as string,
  baseEndpoint: ctx.parameters.baseEndpoint as string,
  value: get(ctx.formValues, ctx.fieldPath) as string | null,
});

export default function Main({ ctx }: PropTypes) {
  const [client, setClient] = useState<Client | null>(null);
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    const {
      value: newValue,
      clientId,
      baseEndpoint,
    } = stateFromPlugin({ ctx });

    const newClient = new Client({ clientId, baseEndpoint });

    setValue(newValue);
    setClient(newClient);
  }, [ctx]);

  const handleSelect = (product: any) => {
    ctx.setFieldValue(ctx.fieldPath, product.attributes.code);
  };

  const handleReset = () => {
    ctx.setFieldValue(ctx.fieldPath, null);
  };

  return (
    <Provider store={store as any}>
      {value ? (
        <Value client={client} value={value} onReset={handleReset} ctx={ctx} />
      ) : (
        <Empty client={client} onSelect={handleSelect} />
      )}
    </Provider>
  );
}
