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
          if (!("previewsWebhook" in values) || !values.previewsWebhook) {
            errors.previewsWebhook = "This field is required!";
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
            <FieldGroup>
              <p>
                Specify a webhook that should be able to generate a preview link
                from the info on the record.
              </p>
              <Field name="previewsWebhook">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="previewsWebhook"
                    label="Web previews webhook"
                    hint="A CORS-enabled endpoint that returns the preview links. It can include a query string. The item, itemType, sandboxsandboxEnvironmentId and locale parameters will be added dynamically."
                    placeholder="https://yourwebsite.com/api/generate-preview-link?token=XXX"
                    required
                    error={error}
                    {...input}
                  />
                )}
              </Field>

              <Section
                title="Configure frontends"
                headerStyle={{ marginBottom: "var(--spacing-m)" }}
              >
                <p>
                  Specify which frontend you want to link, and we will send the
                  following name and URLs to your web previews webhook.
                </p>
                <FieldArray name="frontends">
                  {({ fields }) => (
                    <FieldGroup>
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
                                    error={error}
                                    {...input}
                                  />
                                )}
                              </Field>
                            </div>
                            <div>
                              <Field name={`${name}.previewUrl`}>
                                {({ input, meta: { error } }) => (
                                  <TextField
                                    id="previewUrl"
                                    label="Frontend URL"
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
