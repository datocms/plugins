import type { Client } from '@datocms/cma-client-browser';
import type { OnBootCtx } from 'datocms-plugin-sdk';
import { COMMENT_FIELDS, COMMENTS_MODEL_API_KEY } from '@/constants';
import { createApiClient } from '@/utils/cmaClient';

type CommentsStorageClient = Pick<Client, 'itemTypes' | 'fields'>;
type CommentsModel = Awaited<
  ReturnType<CommentsStorageClient['itemTypes']['list']>
>[number];
type CommentsField = Awaited<
  ReturnType<CommentsStorageClient['fields']['list']>
>[number];
type CommentStorageField = Pick<
  CommentsField,
  'api_key' | 'localized' | 'field_type' | 'validators'
>;

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

function assertCommentFieldCompatible(
  field: CommentStorageField,
  fieldDefinition: (typeof REQUIRED_COMMENT_FIELDS)[number],
): void {
  const requiresUnique = fieldDefinition.api_key === COMMENT_FIELDS.RECORD_ID;
  const hasUniqueValidator =
    field.validators != null &&
    'unique' in field.validators &&
    !!field.validators.unique;
  if (
    field.localized ||
    field.field_type !== fieldDefinition.field_type ||
    (requiresUnique && !hasUniqueValidator)
  ) {
    throw new Error(
      `Comment storage field "${fieldDefinition.api_key}" must be a non-localized ${fieldDefinition.field_type} field${requiresUnique ? ' with a unique validator' : ''}. Existing fields were preserved.`,
    );
  }
}

/** Checks storage used by a cached model ID without changing its schema. */
export function validateCommentsStorageFields(
  fields: CommentStorageField[],
): void {
  for (const definition of REQUIRED_COMMENT_FIELDS) {
    const field = fields.find(
      (candidate) => candidate.api_key === definition.api_key,
    );
    if (!field)
      throw new Error(
        `Comment storage field "${definition.api_key}" is missing.`,
      );
    assertCommentFieldCompatible(field, definition);
  }
}

async function findCommentsModel(
  client: CommentsStorageClient,
): Promise<CommentsModel | null> {
  const existingModels = await client.itemTypes.list();
  return (
    existingModels.find((model) => model.api_key === COMMENTS_MODEL_API_KEY) ??
    null
  );
}

async function ensureCommentField(
  client: CommentsStorageClient,
  modelId: string,
  fieldDefinition: (typeof REQUIRED_COMMENT_FIELDS)[number],
  existingFields: CommentsField[],
): Promise<CommentsField[]> {
  const existingField = existingFields.find(
    (field) => field.api_key === fieldDefinition.api_key,
  );
  if (existingField) {
    assertCommentFieldCompatible(existingField, fieldDefinition);
    return existingFields;
  }

  try {
    const createdField = await client.fields.create(modelId, fieldDefinition);
    assertCommentFieldCompatible(createdField, fieldDefinition);
    return [...existingFields, createdField];
  } catch (error) {
    const refreshedFields = await client.fields.list(modelId);
    const refreshedField = refreshedFields.find(
      (field) => field.api_key === fieldDefinition.api_key,
    );
    if (refreshedField) {
      assertCommentFieldCompatible(refreshedField, fieldDefinition);
      return refreshedFields;
    }

    throw error;
  }
}

async function ensureRequiredCommentFields(
  client: CommentsStorageClient,
  modelId: string,
): Promise<void> {
  const initialFields = await client.fields.list(modelId);

  // Reject incompatible existing fields before creating any missing fields.
  for (const definition of REQUIRED_COMMENT_FIELDS) {
    const field = initialFields.find(
      (candidate) => candidate.api_key === definition.api_key,
    );
    if (field) assertCommentFieldCompatible(field, definition);
  }

  // Each field creation depends on the result of the previous (updated field list),
  // so we chain sequentially using reduce rather than awaiting inside a loop.
  await REQUIRED_COMMENT_FIELDS.reduce(
    async (previousFieldsPromise, fieldDefinition) => {
      const fields = await previousFieldsPromise;
      return ensureCommentField(client, modelId, fieldDefinition, fields);
    },
    Promise.resolve(initialFields),
  );
}

export async function ensureCommentsModelExistsWithClient(
  client: CommentsStorageClient,
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
  ctx: OnBootCtx,
): Promise<string | null> {
  const client = createApiClient(
    ctx.currentUserAccessToken,
    ctx.environment,
    ctx.cmaBaseUrl,
  );
  if (!client) return null;

  return ensureCommentsModelExistsWithClient(client);
}
