import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const openDialog = () => {
    void ctx.openModal({
      id: 'deleteAssetsConfirmation',
      title: 'Delete unused assets',
      width: 'm',
    });
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the section starts the frame, with no
  // Page around it
  return (
    <Canvas ctx={ctx}>
      <Page.Section>
        <Page.SectionDescription>
          Lists the assets that no record uses, so you can review them and
          delete the ones you don't need.
        </Page.SectionDescription>
        <Button label="Scan for unused assets" onClick={openDialog} />
      </Page.Section>
    </Canvas>
  );
}
