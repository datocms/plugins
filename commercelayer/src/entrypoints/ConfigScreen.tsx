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

            if (!("baseEndpoint" in values) || !values.baseEndpoint) {
              errors.baseEndpoint = "This field is required!";
            }

            if (!("clientId" in values) || !values.clientId) {
              errors.clientId = "This field is required!";
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
                <Field name="baseEndpoint">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="baseEndpoint"
                      label="Commerce Layer Base endpoint"
                      placeholder="https://dato-commerce.commercelayer.io"
                      required
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
                <Field name="clientId">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="clientId"
                      label="OAuth Application Client ID"
                      hint="Go to https://[your-instance].commercelayer.io/admin/settings/applications to find your OAuth applications"
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
