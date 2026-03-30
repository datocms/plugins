import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { OnBootCtx } from 'datocms-plugin-sdk';
import { COMMENTS_MODEL_API_KEY, COMMENT_FIELDS } from '@/constants';

type CommentsStorageClient = Pick<Client, 'itemTypes' | 'fields'>;
type CommentsModel = Awaited<ReturnType<CommentsStorageClient['itemTypes']['list']>>[number];
type CommentsField = Awaited<ReturnType<CommentsStorageClient['fields']['list']>>[number];

const REQUIRED_COMMENT_FIELDS = [
  {
    label: 'Model ID',
    api_key: COMMENT_FIELDS.MODEL_ID,
    field_type: 'string' as const,
    validators: { required: {} },
  },
  {
    label: 'Record ID',
    api_key: COMMENT_FIELDS.RECORD_ID,
    field_type: 'string' as const,
    validators: { required: {}, unique: {} },
  },
  {
    label: 'Content',
    api_key: COMMENT_FIELDS.CONTENT,
    field_type: 'json' as const,
    validators: { required: {} },
  },
] as const;

async function findCommentsModel(
  client: CommentsStorageClient
): Promise<CommentsModel | null> {
  const existingModels = await client.itemTypes.list();
  return (
    existingModels.find((model) => model.api_key === COMMENTS_MODEL_API_KEY) ?? null
  );
}

async function ensureCommentField(
  client: CommentsStorageClient,
  modelId: string,
  fieldDefinition: (typeof REQUIRED_COMMENT_FIELDS)[number],
  existingFields: CommentsField[]
): Promise<CommentsField[]> {
  if (existingFields.some((field) => field.api_key === fieldDefinition.api_key)) {
    return existingFields;
  }

  try {
    const createdField = await client.fields.create(modelId, fieldDefinition);
    return [...existingFields, createdField];
  } catch (error) {
    const refreshedFields = await client.fields.list(modelId);
    if (
      refreshedFields.some((field) => field.api_key === fieldDefinition.api_key)
    ) {
      return refreshedFields;
    }

    throw error;
  }
}

async function ensureRequiredCommentFields(
  client: CommentsStorageClient,
  modelId: string
): Promise<void> {
  let existingFields = await client.fields.list(modelId);

  for (const fieldDefinition of REQUIRED_COMMENT_FIELDS) {
    existingFields = await ensureCommentField(
      client,
      modelId,
      fieldDefinition,
      existingFields
    );
  }
}

export async function ensureCommentsModelExistsWithClient(
  client: CommentsStorageClient
): Promise<string> {
  let commentsModel = await findCommentsModel(client);

  if (!commentsModel) {
    try {
      commentsModel = await client.itemTypes.create({
        name: 'Project Comment',
        api_key: COMMENTS_MODEL_API_KEY,
        draft_mode_active: false,
      });
    } catch (error) {
      commentsModel = await findCommentsModel(client);
      if (!commentsModel) {
        throw error;
      }
    }
  }

  await ensureRequiredCommentFields(client, commentsModel.id);
  return commentsModel.id;
}

export async function ensureCommentsModelExists(
  ctx: OnBootCtx
): Promise<string | null> {
  if (!ctx.currentUserAccessToken) return null;

  const client = buildClient({ apiToken: ctx.currentUserAccessToken });
  return ensureCommentsModelExistsWithClient(client);
}
