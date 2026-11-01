import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useEffect, useState } from 'react';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const [onPublish, setOnPublish] = useState(
    (ctx.plugin.attributes.parameters.onPublish as boolean) || false,
  );
  useEffect(() => {
    ctx.updatePluginParameters({ installed: true, onPublish });
  }, [onPublish, ctx.updatePluginParameters]);
  return (
    <Canvas ctx={ctx}>
      <Page>
        <Page.Content>
          <Page.Section>
            <Page.SectionTitle>Redirects</Page.SectionTitle>
            <Page.SectionDescription>
              Add “Slug Redirects” to a slug field as an add-on. Each change of
              that slug then adds a redirect rule, with the old slug as source
              and the new one as destination, to the “Slug Redirects” model.
            </Page.SectionDescription>
            <FieldWrapper hint="Saves are ignored: a rule is added when the record is published. For models with the draft/published system.">
              <SwitchInput
                label="Add redirect rules only on publish"
                value={onPublish}
                onChange={(value) => setOnPublish(Boolean(value))}
              />
            </FieldWrapper>
          </Page.Section>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
