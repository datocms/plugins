import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import styles from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/** Plugin configuration screen displaying usage instructions */
export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <Page className={styles.page}>
        <Page.Content>
          <Page.Section>
            <Page.SectionTitle>How to use</Page.SectionTitle>
            <Page.SectionDescription>
              Add “Tree-like slugs” to a slug field as an add-on, in a model
              with hierarchical sorting. When you save a record with a changed
              slug, the slugs of all the records below it in the tree start with
              the new one.
            </Page.SectionDescription>
            <Callout tone="warning">
              Turn off the “Match a specific pattern” validation of the slug
              field, or it rejects the “/” that the plugin puts between the
              slugs.
            </Callout>
          </Page.Section>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
