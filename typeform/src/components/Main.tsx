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
  apiToken: ctx.plugin.attributes.parameters.apiToken as string,
  corsUrlPrefix: ctx.plugin.attributes.parameters.corsUrlPrefix as string,
  value: get(ctx.formValues, ctx.fieldPath) as string | null,
});

export default function Main({ ctx }: PropTypes) {
  const [client, setClient] = useState<Client | null>(null);
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    const {
      value: newValue,
      apiToken,
      corsUrlPrefix,
    } = stateFromPlugin({ ctx });

    const newClient = new Client({ apiToken, corsUrlPrefix });

    setValue(newValue);
    setClient(newClient);
  }, [ctx]);

  const handleSelect: onSelectType = ({ form }) => {
    ctx.setFieldValue(ctx.fieldPath, form ? form.id : "");
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
