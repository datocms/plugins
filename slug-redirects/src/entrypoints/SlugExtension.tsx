import type { RenderFieldExtensionCtx } from "datocms-plugin-sdk";

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function SlugExtension({ ctx }: PropTypes) {
  void ctx;
  return null;
}
