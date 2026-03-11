import type { RenderUploadSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import type { ConfigParameters } from '../types';
import {
  getDefaultModelForProvider,
  getInitialProvider,
  getProviderApiKey,
  normalizeConfigParameters,
} from '../utils/config';
import { modelSupportsMode } from '../utils/imageService';
import s from './styles.module.css';

type Props = {
  ctx: RenderUploadSidebarPanelCtx;
};

export default function UploadSidebarPanel({ ctx }: Props) {
  const parameters = normalizeConfigParameters(
    (ctx.plugin.attributes.parameters || {}) as ConfigParameters,
  );
  const provider = getInitialProvider(parameters);
  const model = getDefaultModelForProvider(parameters, provider);
  const hasApiKey = Boolean(getProviderApiKey(parameters, provider));
  const supportsEdit = modelSupportsMode(provider, model, 'edit');
  const isImage =
    ctx.upload.attributes.width !== null && ctx.upload.attributes.height !== null;
  const hasUploadAccess = Boolean(ctx.currentUserAccessToken);
  const canOpen = isImage && hasApiKey && supportsEdit && hasUploadAccess;

  let helperText: string | null = null;

  if (!isImage) {
    helperText = 'Only image assets can be edited.';
  } else if (!hasApiKey) {
    helperText = 'Add a provider API key in plugin settings to enable editing.';
  } else if (!supportsEdit) {
    helperText = 'The configured model only supports generation.';
  } else if (!hasUploadAccess) {
    helperText = 'Reinstall the plugin with project API access enabled to create edited assets.';
  }

  return (
    <Canvas ctx={ctx}>
      <div className={s.sidebarPanel}>
        <Button
          buttonType="primary"
          fullWidth
          onClick={async () => {
            await ctx.openModal({
              id: 'edit-upload',
              title: 'Edit image',
              width: 'xl',
              initialHeight: 760,
              parameters: {
                uploadId: ctx.upload.id,
                uploadUrl: ctx.upload.attributes.url,
                filename: ctx.upload.attributes.filename,
                width: ctx.upload.attributes.width,
                height: ctx.upload.attributes.height,
              },
            });
          }}
          disabled={!canOpen}
        >
          Open editor
        </Button>
        {helperText && <div className={s.helperText}>{helperText}</div>}
      </div>
    </Canvas>
  );
}
