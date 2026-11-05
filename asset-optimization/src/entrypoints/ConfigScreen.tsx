import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the section starts the frame, with no
  // Page around it
  return (
    <Canvas ctx={ctx}>
      <Page.Section>
        <Page.SectionDescription>
          Pick the settings, preview the savings, then replace the large images
          of this environment.
        </Page.SectionDescription>
        <Button
          label="Open asset optimization"
          to={`${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/optimize-assets`}
        />
      </Page.Section>
    </Canvas>
  );
}
