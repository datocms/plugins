import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import Main from "../components/Main";
import { ConfigParameters } from "../types";

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: PropTypes) {
  const parameters = ctx.plugin.attributes.parameters as ConfigParameters;

  if (!("clientId" in parameters || "baseEndpoint" in parameters)) {
    return <p>Invalid configuration!</p>;
  }

  return (
    <Canvas ctx={ctx}>
      <Main ctx={ctx} />
    </Canvas>
  );
}
