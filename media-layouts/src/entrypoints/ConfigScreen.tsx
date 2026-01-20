import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Form, SelectField } from 'datocms-react-ui';
import { useState, useCallback } from 'react';
import { ASPECT_RATIO_OPTIONS, WIDTH_OPTIONS } from '../constants';
import { normalizeGlobalParams } from '../utils/fieldParams';
import type { ValidGlobalParams } from '../types';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const [formValues, setFormValues] = useState<ValidGlobalParams>(() =>
    normalizeGlobalParams(ctx.plugin.attributes.parameters)
  );

  const update = useCallback(
    <K extends keyof ValidGlobalParams>(field: K, value: ValidGlobalParams[K]) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.updatePluginParameters(newParameters);
    },
    [formValues, ctx]
  );

  const aspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom'
  ).map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const widthOptions = WIDTH_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const selectedAspectRatio = aspectRatioOptions.find(
    (opt) => opt.value === formValues.defaultAspectRatio
  );

  const selectedWidth = widthOptions.find(
    (opt) => opt.value === formValues.defaultWidth
  );

  return (
    <Canvas ctx={ctx}>
      <Form>
        <SelectField
          id="defaultAspectRatio"
          name="defaultAspectRatio"
          label="Default Aspect Ratio"
          hint="The default aspect ratio for new assets"
          selectInputProps={{
            options: aspectRatioOptions,
          }}
          value={selectedAspectRatio}
          onChange={(option) => {
            if (option && 'value' in option) {
              update('defaultAspectRatio', option.value);
            }
          }}
        />

        <SelectField
          id="defaultWidth"
          name="defaultWidth"
          label="Default Width"
          hint="The default width for new assets"
          selectInputProps={{
            options: widthOptions,
          }}
          value={selectedWidth}
          onChange={(option) => {
            if (option && 'value' in option) {
              update('defaultWidth', option.value);
            }
          }}
        />
      </Form>
    </Canvas>
  );
}
