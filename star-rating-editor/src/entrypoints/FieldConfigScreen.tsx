import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
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
  type FieldParams,
  normalizeFieldParams,
  type ValidFieldParams,
} from '../utils/fieldParams';
import { normalizeGlobalParams } from '../utils/globalParams';

type PropTypes = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

export function validateMaxRating(
  value: string | number | null,
): string | undefined {
  if (
    Number.isNaN(parseInt(value, 10)) ||
    parseInt(value, 10) < 2 ||
    parseInt(value, 10) > 10
  ) {
    return 'Rating must be a number between 2 and 10!';
  }
}

export function validateStarsColor(value: string | null): string | undefined {
  if (!value) {
    return 'A color is required!';
  }

  const s = new Option().style;
  s.color = value;

  if (s.color === '') {
    return 'Invalid color!';
  }
}

export function validate(parameters: Record<string, unknown>) {
  const errors: Record<string, string | undefined> = {};

  const maxRating = parameters.maxRating;
  if (maxRating !== null && maxRating !== undefined) {
    const maxRatingValue =
      typeof maxRating === 'string' || typeof maxRating === 'number'
        ? maxRating
        : String(maxRating);
    errors.maxRating = validateMaxRating(maxRatingValue);
  }

  const starsColor = parameters.starsColor;
  if (starsColor !== null && starsColor !== undefined) {
    errors.starsColor = validateStarsColor(
      typeof starsColor === 'string' ? starsColor : String(starsColor),
    );
  }

  return Object.values(errors).some((x) => x) ? errors : {};
}

const FieldConfigScreen = ({ ctx }: PropTypes) => {
  const globalParams = normalizeGlobalParams(ctx.plugin.attributes.parameters);

  const [formValues, setFormValues] = useState<ValidFieldParams>(
    normalizeFieldParams(ctx.parameters as FieldParams, globalParams),
  );

  type EditableField = 'maxRating' | 'starsColor';

  const update = useCallback(
    (field: EditableField, value: string | number | null) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.setParameters(newParameters);
    },
    [formValues, ctx],
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
