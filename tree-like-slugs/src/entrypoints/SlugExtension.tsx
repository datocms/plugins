import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

/**
 * Field addon component for slug fields.
 * Renders nothing visible - serves as an anchor point for the plugin
 * to register itself with the field, enabling the onBeforeItemUpsert hook.
 */
export default function SlugExtension({}: PropTypes) {
  return <></>;
}
