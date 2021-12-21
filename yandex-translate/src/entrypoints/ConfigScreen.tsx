import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import {
  Button,
  Canvas,
  SwitchField,
  TextField,
  Form,
  FieldGroup,
} from "datocms-react-ui";
import { Form as FormHandler, Field } from "react-final-form";
import { ConfigParameters } from "../types";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <FormHandler<ConfigParameters>
        initialValues={ctx.plugin.attributes.parameters}
        validate={(values: ConfigParameters) => {
          const errors: Record<string, string> = {};

          if (!("yandexApiKey" in values) || !values.yandexApiKey) {
            errors.yandexApiKey = "This field is required!";
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
              <Field name="developmentMode">
                {({ input, meta: { error } }) => (
                  <SwitchField
                    id="developmentMode"
                    label="Development mode?"
                    hint="Enable development logs on the console"
                    error={error}
                    {...input}
                  />
                )}
              </Field>
              <Field name="yandexApiKey">
                {({ input, meta: { error } }) => (
                  <TextField
                    id="yandexApiKey"
                    label="Yandex API Key"
                    hint="The Yandex API Key to use (see https://tech.yandex.com/translate/)"
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
    </Canvas>
  );
}
