import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  TextField,
  Form,
  FieldGroup,
  Section,
  FieldWrapper,
} from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import ColorInput from '../components/ColorInput';
import {
  normalizeGlobalParams,
  ValidGlobalParams,
} from '../utils/globalParams';
import { validateMaxRating, validateStarsColor } from './FieldConfigScreen';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<ValidGlobalParams>
        initialValues={normalizeGlobalParams(ctx.plugin.attributes.parameters)}
        validate={(values: ValidGlobalParams) => {
          return {
            defaultMaxRating: validateMaxRating(values.defaultMaxRating),
            defaultStarsColor: validateStarsColor(values.defaultStarsColor),
          };
        }}
        onSubmit={async (values: ValidGlobalParams) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <FieldGroup>
              <Section title="Default settings">
                <FieldGroup>
                  <p>
                    These settings will be the default for all star-rating
                    editors, unless they're overridden on a per-field basis.
                  </p>
                  <Field name="defaultMaxRating">
                    {({ input, meta: { error } }) => (
                      <TextField
                        id="defaultMaxRating"
                        label="Max rating"
                        hint="The maximum number of stars that can be set for a field"
                        placeholder="my-shop"
                        required
                        error={error}
                        {...input}
                      />
                    )}
                  </Field>
                  <Field name="defaultStarsColor">
                    {({ input, meta: { error } }) => (
                      <FieldWrapper
                        id="defaultStarsColor"
                        label="Stars color"
                        required
                        error={error}
                      >
                        <ColorInput {...input} />
                      </FieldWrapper>
                    )}
                  </Field>
                </FieldGroup>
              </Section>
              <Section title="Automatic mapping">
                <Field name="autoApplyToFieldsWithApiKey">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="autoApplyToFieldsWithApiKey"
                      label="Auto-apply this plugin to all Integer fields fields matching the following API identifier:"
                      hint="A regular expression can be used"
                      placeholder="star_rating"
                      error={error}
                      textInputProps={{ monospaced: true }}
                      {...input}
                    />
                  )}
                </Field>
              </Section>
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
