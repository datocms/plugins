import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  TextField,
  SelectField,
  Form,
  FieldGroup,
  Section,
} from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import { FieldArray } from 'react-final-form-arrays';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { GroupBase } from 'react-select';
import { Config } from '../../types';
import s from './styles.module.css';

// Props for the ConfigScreen component, receiving DatoCMS context
type Props = {
  ctx: RenderConfigScreenCtx;
};

// Basic option interface for the field types
type Option = { label: string; value: string };

// List of valid field types the plugin can handle
const fieldTypes: Option[] = [
  {
    value: 'string',
    label: 'Single-line string',
  },
  {
    value: 'text',
    label: 'Multi-line text',
  },
  {
    value: 'structured_text',
    label: 'Structured text',
  },
];

// Error shape to validate the auto-apply rules
type Errors = {
  autoApplyRules?: Array<{ fieldTypes?: string; apiKeyRegexp?: string }>;
};

// Main ConfigScreen component that handles plugin parameter configuration
export default function ConfigScreen({ ctx }: Props) {
  return (
    // Canvas ensures proper styling and auto-resizing within DatoCMS
    <Canvas ctx={ctx}>
      <FormHandler<Config>
        // Allows array-based form mutations
        mutators={{
          ...arrayMutators,
        }}
        // Load existing plugin parameters
        initialValues={ctx.plugin.attributes.parameters}
        // Custom validation to ensure user input is correct
        validate={(values) => {
          const errors: Errors = {};

          if ('autoApplyRules' in values) {
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
          }

          return errors;
        }}
        // Handles form submission, saving parameters back to the plugin
        onSubmit={async (values) => {
          await ctx.updatePluginParameters(values);
          ctx.notice('Settings updated successfully!');
        }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
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
                            {/* SelectField to pick which field types the rule should match */}
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
                            {/* Regex field to match field API keys */}
                            <Field name={`${name}.apiKeyRegexp`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id="apiKeyRegexp"
                                  label="API key (regexp)"
                                  textInputProps={{ monospaced: true }}
                                  placeholder=".*"
                                  error={error}
                                  {...input}
                                />
                              )}
                            </Field>
                          </div>
                          {/* Button to remove a rule */}
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
                    {/* Button to add a new auto-apply rule */}
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
            {/* Submit button to save the settings */}
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