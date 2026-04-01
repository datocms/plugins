import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  Section,
  SelectField,
  TextField,
} from 'datocms-react-ui';
import arrayMutators from 'final-form-arrays';
import type { FieldRenderProps, FormRenderProps } from 'react-final-form';
import { Field, Form as FormHandler } from 'react-final-form';
import { FieldArray } from 'react-final-form-arrays';
import type { GroupBase } from 'react-select';
import type { AutoApplyRule, Config } from '../../types';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type Option = { label: string; value: string };

const fieldTypes: Option[] = [
  {
    value: 'string',
    label: 'Single-line string',
  },
  {
    value: 'json',
    label: 'JSON field',
  },
];

type Errors = {
  autoApplyRules?: Array<{ fieldTypes?: string; apiKeyRegexp?: string }>;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<Config>
        mutators={{
          // potentially other mutators could be merged here
          ...arrayMutators,
        }}
        initialValues={ctx.plugin.attributes.parameters}
        validate={(values: Config) => {
          const errors: Errors = {};

          if ('autoApplyRules' in values) {
            errors.autoApplyRules = values.autoApplyRules.map(
              (rule: AutoApplyRule) => {
                const ruleErrors: Record<string, string> = {};

                if (!rule.apiKeyRegexp) {
                  ruleErrors.apiKeyRegexp = 'Please specify a regexp!';
                }

                if (rule.fieldTypes.length === 0) {
                  ruleErrors.fieldTypes = 'Please specify at least one!';
                }

                return ruleErrors;
              },
            );
          }

          return errors;
        }}
        onSubmit={async (values) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }: FormRenderProps<Config>) => (
          <Form onSubmit={handleSubmit}>
            <Section
              title="Automatic apply rules"
              headerStyle={{ marginBottom: 'var(--spacing-m)' }}
            >
              <p>Apply automatically on fields matching one of these rules:</p>
              <FieldArray name="autoApplyRules">
                {({ fields }) => (
                  <FieldGroup>
                    {fields.map((name: string, index: number) => (
                      <FieldGroup key={name}>
                        <div className={s.grid}>
                          <div>
                            <Field name={`${name}.fieldTypes`}>
                              {({
                                input,
                                meta: { error },
                              }: FieldRenderProps<string[], HTMLElement>) => (
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
                              {({
                                input,
                                meta: { error },
                              }: FieldRenderProps<string, HTMLElement>) => (
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
              buttonSize="xl"
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
