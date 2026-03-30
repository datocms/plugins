import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Canvas, FieldGroup, Form, SwitchField } from "datocms-react-ui";
import { useEffect, useState } from "react";
import "datocms-react-ui/styles.css";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const [onPublish, setOnPublish] = useState(
    (ctx.plugin.attributes.parameters.onPublish as boolean) || false
  );
  useEffect(() => {
    ctx.updatePluginParameters({ installed: true, onPublish });
  }, [onPublish]);
  return (
    <Canvas ctx={ctx}>
      <p>
        Add it to the slug field you want as a field addon. From then on, all of
        the changes made to that slug field will be logged and saved with a
        "source" and "destination" rule on the "Slug Redirects" model.
      </p>
      <Form>
        <FieldGroup>
          <SwitchField
            name="onPublish"
            id="onPublish"
            label="Add redirect rule only uppon record publication"
            hint="Ignores record saves, only adds a redirect rule when the record is published for models with the Draft/Publish system"
            value={onPublish}
            onChange={() => setOnPublish((previousValue) => !previousValue)}
          />
        </FieldGroup>
      </Form>
    </Canvas>
  );
}
