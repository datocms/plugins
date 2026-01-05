import { type RenderModalCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";

/**
 * Simple modal that displays the raw JSON value for debugging.
 * Triggered from the field context menu
 */

export const DebugModal = ({ ctx }: { ctx: RenderModalCtx }) => {
  const { parameters } = ctx;
  const { value } = parameters as { value: string };
  return (
    <Canvas ctx={ctx}>
      <pre>
        <code>{value}</code>
      </pre>
    </Canvas>
  );
};
