import {
  connect,
  type OnBootCtx,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import CommentsBar from './entrypoints/CommentsBar';
import ConfigScreen from './entrypoints/ConfigScreen';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { COMMENTS_MODEL_API_KEY } from './constants';

TimeAgo.addDefaultLocale(en);

async function ensureCommentsModelExists(ctx: OnBootCtx) {
  if (!ctx.currentUserAccessToken) {
    return; // Cannot create model without access token
  }

  const client = buildClient({
    apiToken: ctx.currentUserAccessToken,
  });

  // Check if the model already exists
  const existingModels = await client.itemTypes.list();
  const commentsModel = existingModels.find(
    (model) => model.api_key === COMMENTS_MODEL_API_KEY
  );

  if (commentsModel) {
    return; // Model already exists
  }

  // Create the project_comment model
  const newModel = await client.itemTypes.create({
    name: 'Project Comment',
    api_key: COMMENTS_MODEL_API_KEY,
    draft_mode_active: false,
  });

  // Create the model_id field (string, required)
  await client.fields.create(newModel.id, {
    label: 'Model ID',
    api_key: 'model_id',
    field_type: 'string',
    validators: {
      required: {},
    },
  });

  // Create the record_id field (string, required, unique)
  await client.fields.create(newModel.id, {
    label: 'Record ID',
    api_key: 'record_id',
    field_type: 'string',
    validators: {
      required: {},
      unique: {},
    },
  });

  // Create the content field (JSON, required)
  await client.fields.create(newModel.id, {
    label: 'Content',
    api_key: 'content',
    field_type: 'json',
    validators: {
      required: {},
    },
  });
}

connect({
  async onBoot(ctx: OnBootCtx) {
    await ensureCommentsModelExists(ctx);
  },
  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebars() {
    return [
      {
        id: 'comments',
        label: 'Comments',
      },
    ];
  },
  renderItemFormSidebar(sidebarId, ctx: RenderItemFormSidebarCtx) {
    if (sidebarId === 'comments') {
      render(<CommentsBar ctx={ctx} />);
    }
  },
});

