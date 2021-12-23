import { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  FieldWrapper,
  Form,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { useCallback, useState } from 'react';
import ColorInput from '../components/ColorInput';
import {
  FieldParams,
  normalizeFieldParams,
  ValidFieldParams,
} from '../utils/fieldParams';
import { normalizeGlobalParams } from '../utils/globalParams';

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

export function validateMaxRating(value: any): string | undefined {
  if (isNaN(parseInt(value)) || parseInt(value) < 2 || parseInt(value) > 10) {
    return 'Rating must be a number between 2 and 10!';
  }
}

export function validateStarsColor(value: any): string | undefined {
  if (!value) {
    return 'A color is required!';
  }

  const s = new Option().style;
  s.color = value;

  if (s.color === '') {
    return 'Invalid color!';
  }
}

export function validate(parameters: Record<string, any>) {
  const errors: Record<string, string | undefined> = {};

  errors.maxRating =
    parameters.maxRating && validateMaxRating(parameters.maxRating);

  errors.starsColor =
    parameters.starsColor && validateStarsColor(parameters.starsColor);

  return Object.values(errors).some((x) => x) ? errors : {};
}

const FieldConfigScreen = ({ ctx }: PropTypes) => {
  const globalParams = normalizeGlobalParams(ctx.plugin.attributes.parameters);

  const [formValues, setFormValues] = useState<ValidFieldParams>(
    normalizeFieldParams(ctx.parameters as FieldParams, globalParams),
  );

  const update = useCallback(
    (field, value) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.setParameters(newParameters);
    },
    [formValues, setFormValues, ctx],
  );

  const errors = ctx.errors as Partial<Record<string, string>>;

  return (
    <Canvas ctx={ctx}>
      <Form>
        <SwitchField
          id="useDefaultMaxRating"
          name="useDefaultMaxRating"
          label="Use default maximum rating?"
          value={formValues.maxRating === null}
          onChange={(checked) =>
            update('maxRating', checked ? null : globalParams.defaultMaxRating)
          }
        />
        {formValues.maxRating !== null && (
          <TextField
            id="maxRating"
            name="maxRating"
            label="Override maximum rating"
            required
            value={formValues.maxRating}
            onChange={update.bind(null, 'maxRating')}
            error={errors.maxRating}
          />
        )}
        <SwitchField
          id="useDefaultStarsColor"
          name="useDefaultStarsColor"
          label="Use default stars color?"
          value={formValues.starsColor === null}
          onChange={(checked) =>
            update(
              'starsColor',
              checked ? null : globalParams.defaultStarsColor,
            )
          }
        />
        {formValues.starsColor !== null && (
          <FieldWrapper
            id="starsColor"
            label="Stars color"
            error={errors.starsColor}
          >
            <ColorInput
              value={formValues.starsColor}
              onChange={update.bind(null, 'starsColor')}
            />
          </FieldWrapper>
        )}
      </Form>
    </Canvas>
  );
};

export default FieldConfigScreen;
