import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { Field, Form as FormHandler } from 'react-final-form';
import {
  normalizeGlobalParams,
  type ValidGlobalParams,
} from '../../utils/globalParams';

type Props = {
  ctx: RenderConfigScreenCtx;
};

const MIN_FIELDS_FLOOR = 1;

// `TextField` returns the raw string value from the input; coerce here so the
// stored params satisfy `isValidGlobalParams` (it checks for `number`,
// otherwise the value is silently reset to the default on the next read).
function parseMinFieldsToShow(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(MIN_FIELDS_FLOOR, Math.floor(value));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_FIELDS_FLOOR, parsed);
    }
  }
  return MIN_FIELDS_FLOOR;
}

function validateMinFieldsToShow(value: unknown): string | undefined {
  if (value === undefined || value === '' || value === null) {
    return 'Please specify a minimum number of fields.';
  }
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return 'Please enter a whole number.';
  }
  if (parsed < MIN_FIELDS_FLOOR) {
    return `The minimum is ${MIN_FIELDS_FLOOR}.`;
  }
  return undefined;
}

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<ValidGlobalParams>
        initialValues={normalizeGlobalParams(ctx.plugin.attributes.parameters)}
        onSubmit={async (values) => {
          const normalized: ValidGlobalParams = {
            paramsVersion: '2',
            startOpen: Boolean(values.startOpen),
            minFieldsToShow: parseMinFieldsToShow(values.minFieldsToShow),
          };
          await ctx.updatePluginParameters(normalized);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field
                name="minFieldsToShow"
                validate={validateMinFieldsToShow}
                parse={(value) =>
                  value === '' || value === undefined
                    ? value
                    : parseMinFieldsToShow(value)
                }
              >
                {({ input, meta: { error, touched } }) => (
                  <TextField
                    id="minFieldsToShow"
                    label="Show the sidebar panel for all models with at least this number of fields:"
                    required
                    error={touched ? error : undefined}
                    textInputProps={{
                      type: 'number',
                      min: MIN_FIELDS_FLOOR,
                      step: 1,
                    }}
                    {...input}
                    value={
                      input.value === undefined || input.value === null
                        ? ''
                        : String(input.value)
                    }
                  />
                )}
              </Field>
              <Field name="startOpen">
                {({ input, meta: { error } }) => (
                  <SwitchField
                    id="startOpen"
                    label="Start the sidebar panel open?"
                    error={error}
                    {...input}
                  />
                )}
              </Field>
            </FieldGroup>
            <Button
              type="submit"
              fullWidth
              buttonSize="l"
              buttonType="primary"
              disabled={submitting || !dirty}
            >
              Save settings
            </Button>
          </Form>
        )}
      </FormHandler>
    </Canvas>
  );
}
