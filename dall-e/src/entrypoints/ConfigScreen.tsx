import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, TextField, Form, FieldGroup } from 'datocms-react-ui';
import { Form as FormHandler, Field } from 'react-final-form';
import { ConfigParameters } from '../types';
import s from './styles.module.css';

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
            if ('apiKey' in values && values.apiKey) {
              return {};
            }

            return { apiKey: 'This field is required!' };
          }}
          onSubmit={async (values: ConfigParameters) => {
            await ctx.updatePluginParameters(values);
            ctx.notice('Settings updated successfully!');
          }}
        >
          {({ handleSubmit, submitting, dirty }) => (
            <Form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field name="apiKey">
                  {({ input, meta: { error } }) => (
                    <TextField
                      id="apiKey"
                      label="OpenAI API key"
                      placeholder="sk-......."
                      hint={
                        <>
                          Please insert your OpenAI API key (it starts with{' '}
                          <code>sk-</code>). You can generate it{' '}
                          <a
                            href="https://beta.openai.com/docs/quickstart/add-your-api-key"
                            target="_blank"
                            rel="noreferrer"
                          >
                            from here
                          </a>
                          .
                        </>
                      }
                      required={true}
                      error={error}
                      {...input}
                    />
                  )}
                </Field>
              </FieldGroup>
              <Button
                type="submit"
                fullWidth={true}
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
