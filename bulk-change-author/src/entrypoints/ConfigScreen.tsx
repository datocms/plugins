import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import s from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the section starts the frame, with no
  // Page around it
  return (
    <Canvas ctx={ctx}>
      <Page.Section className={s.endSection}>
        <Page.SectionDescription>
          In the table view of a model, select the records, then choose “Change
          creators…” from the menu of the selection. Pick the new creator (a
          collaborator, an SSO user or the project owner) and confirm.
        </Page.SectionDescription>
      </Page.Section>
    </Canvas>
  );
}
