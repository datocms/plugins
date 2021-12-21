import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Button, Canvas, TextField, Form, FieldGroup } from "datocms-react-ui";
import { Form as FormHandler, Field } from "react-final-form";
import { ConfigParameters } from "../types";
import s from "./styles.module.css";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <div className={s.inspector}>
        <FormHandler<ConfigParameters>
          initialValues={ctx.plugin.attributes.parameters}
          validate={(values: ConfigParameters) => {
            const errors: Record<string, string> = {};

            if (!("apiToken" in values) || !values.apiToken) {
              errors.apiToken = "This field is required!";
            }

            if (!("corsUrlPrefix" in values) || !values.corsUrlPrefix) {
              errors.corsUrlPrefix = "This field is required!";
            }

            return errors;
          }}
          onSubmit={async (values: ConfigParameters) => {
            await ctx.updatePluginParameters(values);
            ctx.notice("Settings updated successfully!");
          }}
        >
          {({ handleSubmit, submitting, dirty }) => (
            <Form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field name="apiToken">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="apiToken"
                      label="Typeform personal token"
                      placeholder="XXX"
                      hint={`Please insert your Typeform personal access token. Take a look at <a href="https://developer.typeform.com/get-started/personal-access-token/">Typeform documentation</a> for more info`}
                      required
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
                <Field name="corsUrlPrefix">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="corsUrlPrefix"
                      label="CORS proxy service"
                      placeholder="CORS proxy service"
                      hint={`Since Typeform API does not support CORS, a CORS proxy is required. For a list of such services, take a look at <a href="https://nordicapis.com/10-free-to-use-cors-proxies/">this resource</a>. When in doubt, leave as it is.`}
                      required
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
      </div>
    </Canvas>
  );
}
