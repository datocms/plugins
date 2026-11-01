import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NumberInput from 'datocms-react-ui/NumberInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useState } from 'react';
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

export function validateMaxRating(value: string | number): string | undefined {
  const parsedValue = Number.parseInt(String(value), 10);

  if (Number.isNaN(parsedValue) || parsedValue < 2 || parsedValue > 10) {
    return 'Enter a number from 2 to 10.';
  }
}

export function validateStarsColor(value: string | null): string | undefined {
  if (!value) {
    return 'Enter a color.';
  }

  const s = new Option().style;
  s.color = value;

  if (s.color === '') {
    return 'Enter a valid CSS color, such as #FFB400.';
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

  const update = (field: EditableField, value: string | number | null) => {
    const newParameters = { ...formValues, [field]: value };
    setFormValues(newParameters);
    ctx.setParameters(newParameters);
  };

  const errors = ctx.errors as Partial<Record<string, string>>;

  // An emptied override input stores '', never null: null means "use the
  // default" and would hide the input, while '' fails validation and blocks
  // the save
  return (
    <Canvas ctx={ctx}>
      <FieldWrapper
        hint={`${globalParams.defaultMaxRating} stars, from the plugin settings.`}
      >
        <SwitchInput
          label="Use the default maximum rating"
          value={formValues.maxRating === null}
          onChange={(on) =>
            update('maxRating', on ? null : globalParams.defaultMaxRating)
          }
        />
      </FieldWrapper>
      {formValues.maxRating !== null && (
        <FieldWrapper
          label="Maximum rating"
          required
          hint="From 2 to 10."
          error={errors.maxRating}
        >
          <NumberInput
            inputMode="numeric"
            placeholder="5"
            value={formValues.maxRating}
            onChange={(value) => update('maxRating', value ?? '')}
          />
        </FieldWrapper>
      )}
      <FieldWrapper
        hint={`${globalParams.defaultStarsColor}, from the plugin settings.`}
      >
        <SwitchInput
          label="Use the default stars color"
          value={formValues.starsColor === null}
          onChange={(on) =>
            update('starsColor', on ? null : globalParams.defaultStarsColor)
          }
        />
      </FieldWrapper>
      {formValues.starsColor !== null && (
        <FieldWrapper label="Stars color" required error={errors.starsColor}>
          <ColorInput
            value={formValues.starsColor}
            onChange={(value) => update('starsColor', value ?? '')}
          />
        </FieldWrapper>
      )}
    </Canvas>
  );
};

export default FieldConfigScreen;
