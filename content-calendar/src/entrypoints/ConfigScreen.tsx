import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, SwitchField } from 'datocms-react-ui';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type EmptyParameters = {};

type ValidParameters = {
  showPage: boolean;
};

type Parameters = EmptyParameters | ValidParameters;

export default function ConfigScreen({ ctx }: Props) {
  const parameters = ctx.plugin.attributes.parameters as Parameters;

  return (
    <Canvas ctx={ctx}>
      {JSON.stringify(ctx.plugin.attributes.parameters)}
      <SwitchField
        id="showPage"
        name="showPage"
        label="Show page?"
        value={'showPage' in parameters ? parameters.showPage : false}
        onChange={async (newValue) => {
          await ctx.updatePluginParameters({
            showPage: newValue,
          });
          ctx.notice('Salvato!');
        }}
      />
    </Canvas>
  );
}
