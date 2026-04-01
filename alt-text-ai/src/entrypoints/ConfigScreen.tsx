import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  Spinner,
  TextField,
} from 'datocms-react-ui';
import s from './styles.module.css';
import { useState } from 'react';

const ALT_TEXT_API_KEYS_URL = 'https://alttext.ai/account/api_keys';
const SAVE_SUCCESS_TOAST = 'API key saved!';
const SAVE_ERROR_PREFIX = 'Failed to save API key:';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type PluginParameters = {
  apiKey?: unknown;
};

function getInitialApiKey(ctx: RenderConfigScreenCtx): string {
  const parameters = ctx.plugin.attributes.parameters as PluginParameters;
  const apiKey = parameters.apiKey;

  return typeof apiKey === 'string' ? apiKey : '';
}

async function saveApiKey(
  ctx: RenderConfigScreenCtx,
  apiKey: string,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
) {
  setIsLoading(true);
  try {
    await ctx.updatePluginParameters({ apiKey: apiKey.trim() });
    ctx.customToast({
      type: 'notice',
      message: SAVE_SUCCESS_TOAST,
      dismissOnPageChange: true,
      dismissAfterTimeout: 5000,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    await ctx.alert(`${SAVE_ERROR_PREFIX} ${message}`);
  } finally {
    setIsLoading(false);
  }
}

export default function ConfigScreen({ ctx }: Props) {
  const [apiKey, setApiKey] = useState(getInitialApiKey(ctx));
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
          <a
            href={ALT_TEXT_API_KEYS_URL}
            target="_blank"
            rel="noreferrer"
          >
            {ALT_TEXT_API_KEYS_URL}
          </a>
        </p>
      </div>

      <Button
        disabled={isLoading || apiKey.trim() === ''}
        fullWidth
        onClick={() => void saveApiKey(ctx, apiKey, setIsLoading)}
      >
        Save {isLoading && <Spinner size={24} />}
      </Button>
    </Canvas>
  );
}
