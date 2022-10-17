import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import {
  Button,
  Canvas,
  TextField,
  Form,
  FieldGroup,
  SwitchField,
  Section,
} from "datocms-react-ui";
import { Form as FormHandler, Field } from "react-final-form";
import arrayMutators from "final-form-arrays";
import { FieldArray } from "react-final-form-arrays";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { Parameters } from "../../types";
import s from "./styles.module.css";

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: PropTypes) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<Parameters>
        initialValues={ctx.plugin.attributes.parameters}
        validate={(values) => {
          const errors: Record<string, string> = {};

          if (
            !("frontends" in values) ||
            !values.frontends ||
            values.frontends.length === 0
          ) {
            errors.frontends = "You need to specify at least one frontend";
          }

          return errors;
        }}
        onSubmit={async (values) => {
          await ctx.updatePluginParameters(values);
          ctx.notice("Settings updated successfully!");
        }}
        mutators={{ ...arrayMutators }}
      >
        {({ handleSubmit, submitting, dirty }) => (
          <Form onSubmit={handleSubmit}>
            <Section
              title="Configure frontends"
              headerStyle={{ marginBottom: "var(--spacing-m)" }}
            >
              <p>
                Specify the webhook that will generate the preview links, and a
                name for each frontend.
              </p>
              <FieldArray name="frontends">
                {({ fields, meta: { error: fieldError } }) => (
                  <FieldGroup>
                    {fieldError && <p className={s.error}>{fieldError}</p>}
                    {fields.map((name, index) => (
                      <FieldGroup key={name}>
                        <div className={s.grid}>
                          <div>
                            <Field name={`${name}.name`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id="name"
                                  label="Frontend name"
                                  placeholder="Staging"
                                  required
                                  error={error || fieldError}
                                  {...input}
                                />
                              )}
                            </Field>
                          </div>
                          <div>
                            <Field name={`${name}.previewWebhook`}>
                              {({ input, meta: { error } }) => (
                                <TextField
                                  id="previewWebhook"
                                  required
                                  label="Preview webhook"
                                  placeholder="https://staging.yourwebsite.com/"
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
                      onClick={() => fields.push({ url: "", name: "" })}
                    >
                      Add new frontend
                    </Button>
                  </FieldGroup>
                )}
              </FieldArray>
            </Section>
            <Section title="Optional">
              <FieldGroup>
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
