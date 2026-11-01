import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import styles from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <Page className={styles.page}>
        <Page.Content>
          <Page.Group title="How to use">
            <p>
              In the table view of a model, select the records, then choose
              “Change creators…” from the menu of the selection. Pick the new
              creator (a collaborator, an SSO user or the project owner) and
              confirm.
            </p>
          </Page.Group>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
