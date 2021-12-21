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

            if (!("shopifyDomain" in values) || !values.shopifyDomain) {
              errors.shopifyDomain = "This field is required!";
            }

            if (
              !("storefrontAccessToken" in values) ||
              !values.storefrontAccessToken
            ) {
              errors.storefrontAccessToken = "This field is required!";
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
                <Field name="shopifyDomain">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="shopifyDomain"
                      label="Shop ID"
                      hint="If your shop is at https://foo-bar.myshopify.com/, then insert foo-bar"
                      placeholder="my-shop"
                      required
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
                <Field name="storefrontAccessToken">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="storefrontAccessToken"
                      label="Storefront access token"
                      hint={`You can get a Storefront access token by creating a private app. Take a look at <a href="https://help.shopify.com/en/api/custom-storefronts/storefront-api/getting-started#authentication">Shopify documentation</a> for more info`}
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
