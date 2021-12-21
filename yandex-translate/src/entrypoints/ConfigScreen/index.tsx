import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  TextField,
  Form,
  SelectField,
  FieldGroup,
  Section,
} from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import { FieldArray } from 'react-final-form-arrays';
import { GroupBase } from 'react-select';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { normalizeParams, ValidParameters } from '../../types';
import s from './styles.module.css';

type Option = { label: string; value: string };

const fieldTypes: Option[] = [
  {
    value: 'string',
    label: 'Single-line string',
  },
  {
    value: 'text',
    label: 'Multi-line text',
  },
];

type Props = {
  ctx: RenderConfigScreenCtx;
};

type Errors = {
  yandexApiKey?: string;
  autoApplyRules?: Array<{ fieldTypes?: string; apiKeyRegexp?: string }>;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<ValidParameters>
        mutators={{
          // potentially other mutators could be merged here
          ...arrayMutators,
        }}
        initialValues={normalizeParams(ctx.plugin.attributes.parameters)}
        validate={(values: ValidParameters) => {
          const errors: Errors = {};

          if (!('yandexApiKey' in values) || !values.yandexApiKey) {
            errors.yandexApiKey = 'This field is required!';
          }

          errors.autoApplyRules = values.autoApplyRules.map((rule) => {
            const ruleErrors: Record<string, string> = {};

            if (!rule.apiKeyRegexp) {
              ruleErrors.apiKeyRegexp = 'Please specify a regexp!';
            }

            if (rule.fieldTypes.length === 0) {
              ruleErrors.fieldTypes = 'Please specify at least one!';
            }

            return ruleErrors;
          });

          return errors;
        }}
        onSubmit={async (values: ValidParameters) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field name="yandexApiKey">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="yandexApiKey"
                    label="Yandex API Key"
                    hint={
                      <>
                        The Yandex API Key to use (for more info,{' '}
                        <a
                          href="https://tech.yandex.com/translate/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          tech.yandex.com/translate
                        </a>
                        )
                      </>
                    }
                    textInputProps={{ monospaced: true }}
                    required
                    error={error}
                    {...input}
                  />
                )}
              </Field>
            </FieldGroup>
            <Section
              title="Automatic apply rules"
              headerStyle={{ marginBottom: 'var(--spacing-m)' }}
            >
              <p>Apply automatically on fields matching one of these rules:</p>
              <FieldArray name="autoApplyRules">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name, index) => (
                      <FieldGroup key={name}>
                        <div className={s.grid}>
                          <div>
                            <Field name={`${name}.fieldTypes`}>
                              {({ input, meta: { error } }) => (
                                <SelectField<Option, true, GroupBase<Option>>
                                  {...input}
                                  id="fieldTypes"
                                  label="Field types"
                                  selectInputProps={{
                                    isMulti: true,
                                    options: fieldTypes,
                                  }}
                                  value={fieldTypes.filter((ft) =>
                                    input.value.includes(ft.value),
                                  )}
                                  onChange={(option) =>
                                    input.onChange(
                                      option.map((option) => option.value),
                                    )
                                  }
                                  error={error}
                                />
                              )}
                            </Field>
                          </div>
                          <div>
                            <Field name={`${name}.apiKeyRegexp`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id="apiKeyRegexp"
                                  label="API key (regexp)"
                                  textInputProps={{ monospaced: true }}
                                  error={error}
                                  {...input}
                                />
                              )}
                            </Field>
                          </div>
                          <Button
                            type="button"
                            buttonType="negative"
                            buttonSize="xxs"
                            leftIcon={<FontAwesomeIcon icon={faTrash} />}
                            onClick={() => fields.remove(index)}
                          />
                        </div>
                      </FieldGroup>
                    ))}
                    <Button
                      type="button"
                      buttonSize="xxs"
                      leftIcon={<FontAwesomeIcon icon={faPlus} />}
                      onClick={() =>
                        fields.push({ fieldTypes: [], apiKeyRegexp: '' })
                      }
                    >
                      Add new rule
                    </Button>
                  </FieldGroup>
                )}
              </FieldArray>
            </Section>
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
