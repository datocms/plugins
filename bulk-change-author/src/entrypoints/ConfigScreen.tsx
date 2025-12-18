import type { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Canvas, Section } from "datocms-react-ui";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <Section title="How to use">
        <ol>
          <li>Select records in a tabular view and choose “Change creators…” from the dropdown.</li>
          <li>Pick the collaborator who should become the new creator.</li>
          <li>Confirm the action to update all selected records.</li>
        </ol>
      </Section>
    </Canvas>
  );
}
