import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  ContextInspector,
  Spinner,
  TextField,
} from 'datocms-react-ui';
import s from './styles.module.css';
import { useState } from 'react';

type Props = {
  ctx: RenderConfigScreenCtx;
};

async function saveApiKey(
  ctx: RenderConfigScreenCtx,
  apiKey: string,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
) {
  setIsLoading(true);
  await ctx.updatePluginParameters({ apiKey });
  setIsLoading(false);
  ctx.customToast({
    type: 'notice',
    message: 'API Key Saved!',
    dismissOnPageChange: true,
    dismissAfterTimeout: 5000,
  });
}

export default function ConfigScreen({ ctx }: Props) {
  const [apiKey, setApiKey] = useState(
    (ctx.plugin.attributes.parameters.apiKey as string) ?? ''
  );
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Canvas ctx={ctx}>
      <div className={s.form}>
        <TextField
          required
          name="altTextAPIKey"
          id="altTextAPIKey"
          label="Alt Text API Key"
          value={apiKey}
          onChange={(newValue) => setApiKey(newValue)}
        />
        <p>
          You can get your API key by going to{' '}
          <a href="https://alttext.ai/account/api_keys" target="_blank">
            https://alttext.ai/account/api_keys
          </a>
        </p>
      </div>

      <Button
        disabled={isLoading}
        fullWidth
        onClick={() => saveApiKey(ctx, apiKey, setIsLoading)}
      >
        Save {isLoading && <Spinner size={24} />}
      </Button>
    </Canvas>
  );
}
