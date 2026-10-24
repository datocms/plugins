import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import SettingsList from 'datocms-react-ui/SettingsList';

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

  return (
    <Canvas ctx={ctx}>
      <Page>
        <Page.Content>
          <Page.Group title="Unused assets">
            <SettingsList>
              <SettingsList.Row
                title="Find and delete unused assets"
                description="Lists the assets that no record uses, so you can review them and delete the ones you don't need."
                action={
                  <Button
                    tone="ghost"
                    label="Scan for unused assets"
                    onClick={openDialog}
                  />
                }
              />
            </SettingsList>
          </Page.Group>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
