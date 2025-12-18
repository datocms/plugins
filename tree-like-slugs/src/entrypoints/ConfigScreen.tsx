import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import "datocms-react-ui/styles.css";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <p>
        Add it to the slug field you want as a field addon, the model where that
        slug is in must be set with a "Tree-like" presentation. From then on,
        all of the slugs in the tree-like configuration will inherit as a prefix
        the slug on the parent record.
      </p>
      <h4>
        The slug field must have the "Match a specific pattern" validation
        disabled! Otherwise the plugin won't be able to insert '/' in the slug.
      </h4>
    </Canvas>
  );
}
