import { SchemaRepository } from '@datocms/cma-client';
import { buildClient, type Client } from '@datocms/cma-client-browser';
import type {
  Field,
  ItemType,
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import md5 from 'md5';
import type {
  FieldInfo,
  ModelInfo,
  UserInfo,
} from '../recordComments/entrypoints/hooks/useMentions';
import { extractLeadingEmoji } from '../recordComments/entrypoints/utils/emojiUtils';
import { parsePublicAssetUrl } from './assetUrlPolicy';
import {
  createAssetMention,
  createRecordMention,
  mentionThumbnailUrl,
  resolveAssetMention,
} from './entityMentions';
import { openFileDetailsModal } from './fileDetailsModal';
import { hasSessionLocalFileBytes } from './localFiles';
import type { AssetMention, LocalFileMention, RecordMention } from './mentions';
import { fallbackAssetMention, fallbackRecordMention } from './mentions';

type MentionCtx = RenderInspectorCtx | RenderItemFormSidebarCtx;

export type AgentMentionUserInfo = UserInfo & {
  userType: 'user' | 'sso' | 'owner';
};

export type AgentMentionHost = {
  currentUser: AgentMentionUserInfo;
  projectOwnerId: string;
  projectModels: ModelInfo[];
  recordModels: ModelInfo[];
  canMentionFields: boolean;
  canMentionAssets: boolean;
  canMentionModels: boolean;
  /**
   * Asset creation is deliberately separate from asset references and the
   * Remote MCP. Attaching a file never calls this function by itself.
   */
  canCreateAssets?: boolean;
  loadProjectUsers: () => Promise<AgentMentionUserInfo[]>;
  loadModelFields?: () => Promise<FieldInfo[]>;
  selectAsset: () => Promise<AssetMention | undefined>;
  selectRecord: (model: ModelInfo) => Promise<RecordMention | undefined>;
  resolveAsset: (input: {
    uploadId: string;
    label?: string;
  }) => Promise<AssetMention>;
  resolveRecord: (input: {
    itemId: string;
    itemTypeId?: string;
    label?: string;
  }) => Promise<RecordMention>;
  /**
   * Clears successful record and asset presentation lookups after a CMS write.
   * Unsafe scripts can affect arbitrary entities, so invalidation is global.
   */
  invalidatePresentationCache?: () => void;
  createAsset?: (
    input: AgentAssetCreationInput,
    options?: AgentAssetCreationOptions,
  ) => Promise<AssetMention>;
  openUser: (userId: string) => void | Promise<void>;
  openModel: (modelId: string, isBlockModel: boolean) => void;
  openLocalFile: (file: LocalFileMention) => Promise<void>;
};

export type AgentAssetCreationInput =
  | {
      source: 'file';
      fileOrBlob: File | Blob;
      filename: string;
    }
  | {
      source: 'url';
      url: string;
      filename?: string;
    };

export type AgentAssetCreationOptions = {
  /** Session-wide auto approve can bypass this one native confirmation. */
  skipConfirmation?: boolean;
  signal?: AbortSignal;
  /** Runs immediately before the first irreversible upload request is made. */
  onUploadDispatch?: () => void;
};

export const MAX_LOCAL_ASSET_URL_BYTES = 50 * 1024 * 1024;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function emailName(email: string): string {
  return email.split('@')[0] || 'User';
}

function gravatarUrl(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return normalized
    ? `https://www.gravatar.com/avatar/${md5(normalized)}?d=mp&s=96`
    : null;
}

function currentUserInfo(ctx: MentionCtx): AgentMentionUserInfo {
  if (ctx.currentUser.type === 'user') {
    return regularUserInfo(ctx.currentUser);
  }
  if (ctx.currentUser.type === 'sso_user') {
    return ssoUserInfo(ctx.currentUser);
  }
  if (
    ctx.currentUser.type === 'account' ||
    ctx.currentUser.type === 'organization'
  ) {
    return ownerInfo(ctx);
  }

  const currentUser = objectValue(ctx.currentUser);
  const attributes = objectValue(currentUser.attributes);
  const email = stringValue(currentUser.email) || stringValue(attributes.email);
  return {
    id: stringValue(currentUser.id) || 'current-user',
    email,
    name:
      stringValue(currentUser.full_name) ||
      stringValue(attributes.full_name) ||
      emailName(email),
    avatarUrl: gravatarUrl(email),
    userType: 'user',
  };
}

function ownerInfo(ctx: MentionCtx): AgentMentionUserInfo {
  const owner = objectValue(ctx.owner);
  const attributes = objectValue(owner.attributes);
  const email = stringValue(owner.email) || stringValue(attributes.email);
  const firstName =
    stringValue(owner.first_name) || stringValue(attributes.first_name);
  const lastName =
    stringValue(owner.last_name) || stringValue(attributes.last_name);
  const name =
    stringValue(owner.name) ||
    stringValue(attributes.name) ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    emailName(email) ||
    'Project owner';

  return {
    id: stringValue(owner.id) || 'project-owner',
    email,
    name,
    avatarUrl: gravatarUrl(email),
    userType: 'owner',
  };
}

function regularUserInfo(user: {
  id: string;
  attributes: { email: string; full_name?: string | null };
}): AgentMentionUserInfo {
  return {
    id: user.id,
    email: user.attributes.email,
    name: user.attributes.full_name || emailName(user.attributes.email),
    avatarUrl: gravatarUrl(user.attributes.email),
    userType: 'user',
  };
}

function ssoUserInfo(user: {
  id: string;
  attributes: {
    username: string;
    first_name?: string | null;
    last_name?: string | null;
  };
}): AgentMentionUserInfo {
  const username = user.attributes.username;
  return {
    id: user.id,
    email: username,
    name:
      [user.attributes.first_name, user.attributes.last_name]
        .filter(Boolean)
        .join(' ') || emailName(username),
    avatarUrl: username.includes('@') ? gravatarUrl(username) : null,
    userType: 'sso',
  };
}

type RegularUsersResult = PromiseSettledResult<
  Awaited<ReturnType<MentionCtx['loadUsers']>>
>;
type SsoUsersResult = PromiseSettledResult<
  Awaited<ReturnType<MentionCtx['loadSsoUsers']>>
>;

function regularUsersFromResult(
  result: RegularUsersResult,
): AgentMentionUserInfo[] {
  return result.status === 'fulfilled' ? result.value.map(regularUserInfo) : [];
}

function ssoUsersFromResult(result: SsoUsersResult): AgentMentionUserInfo[] {
  return result.status === 'fulfilled' ? result.value.map(ssoUserInfo) : [];
}

function bothUserLoadsFailed(
  regularUsers: RegularUsersResult,
  ssoUsers: SsoUsersResult,
): boolean {
  return regularUsers.status === 'rejected' && ssoUsers.status === 'rejected';
}

function presentEntities<T>(repo: Partial<Record<string, T>>): T[] {
  return Object.values(repo).filter((value): value is T => Boolean(value));
}

type MentionPermission = {
  environment: string;
  action: string;
  item_type?: string | null;
};

function permissionMatches(
  permission: MentionPermission,
  environment: string,
  itemTypeId?: string,
): boolean {
  const actionMatches =
    permission.action === 'all' || permission.action === 'read';
  const itemTypeMatches =
    itemTypeId === undefined ||
    permission.item_type === null ||
    permission.item_type === itemTypeId;
  return (
    permission.environment === environment && actionMatches && itemTypeMatches
  );
}

function permissionGranted(
  positive: readonly MentionPermission[],
  negative: readonly MentionPermission[],
  environment: string,
  itemTypeId?: string,
): boolean {
  const matches = (permission: MentionPermission) =>
    permissionMatches(permission, environment, itemTypeId);
  return positive.some(matches) && !negative.some(matches);
}

function currentRole(ctx: MentionCtx): MentionCtx['currentRole'] | undefined {
  return (ctx as MentionCtx & { currentRole?: MentionCtx['currentRole'] })
    .currentRole;
}

function canMentionAssets(ctx: MentionCtx): boolean {
  const role = currentRole(ctx);
  if (!role) return false;
  return permissionGranted(
    role.attributes.positive_upload_permissions ?? [],
    role.attributes.negative_upload_permissions ?? [],
    ctx.environment,
  );
}

type UploadPermission = MentionPermission & {
  upload_collection?: string | null;
};

function canCreateAssets(ctx: MentionCtx): boolean {
  const role = currentRole(ctx);
  if (!role || !ctx.currentUserAccessToken) return false;

  const finalPermissions = objectValue(role.meta.final_permissions);
  const positive = (
    Array.isArray(finalPermissions.positive_upload_permissions)
      ? finalPermissions.positive_upload_permissions
      : (role.attributes.positive_upload_permissions ?? [])
  ) as UploadPermission[];
  const negative = (
    Array.isArray(finalPermissions.negative_upload_permissions)
      ? finalPermissions.negative_upload_permissions
      : (role.attributes.negative_upload_permissions ?? [])
  ) as UploadPermission[];
  const matchesRootCreation = (permission: UploadPermission) =>
    permission.environment === ctx.environment &&
    (permission.action === 'all' || permission.action === 'create') &&
    !permission.upload_collection;

  return (
    positive.some(matchesRootCreation) && !negative.some(matchesRootCreation)
  );
}

function canMentionModels(ctx: MentionCtx): boolean {
  return currentRole(ctx)?.meta.final_permissions.can_edit_schema ?? false;
}

function readableModels(ctx: MentionCtx, models: readonly ModelInfo[]) {
  const role = currentRole(ctx);
  if (!role) return [];
  const positive = role.attributes.positive_item_type_permissions ?? [];
  const negative = role.attributes.negative_item_type_permissions ?? [];
  return models.filter((model) =>
    permissionGranted(positive, negative, ctx.environment, model.id),
  );
}

export function projectModelsFromItemTypes(
  itemTypes: Partial<Record<string, ItemType>>,
): ModelInfo[] {
  return presentEntities(itemTypes)
    .map((itemType) => ({
      id: itemType.id,
      apiKey: itemType.attributes.api_key,
      name: itemType.attributes.name,
      isBlockModel: itemType.attributes.modular_block,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function modelFields(fields: readonly Field[], locales: readonly string[]) {
  return fields
    .slice()
    .sort((left, right) => left.attributes.position - right.attributes.position)
    .map(
      (field): FieldInfo => ({
        apiKey: field.attributes.api_key,
        label: field.attributes.label,
        localized: field.attributes.localized,
        fieldPath: field.attributes.api_key,
        displayLabel: field.attributes.label,
        depth: 0,
        ...(field.attributes.localized
          ? { availableLocales: [...locales] }
          : {}),
        fieldType:
          field.attributes.appearance.editor || field.attributes.field_type,
        // The agent composer intentionally references nested containers as a
        // whole. It never attempts to inspect unsaved block structure here.
        isBlockContainer: false,
      }),
    );
}

function environmentPrefix(ctx: MentionCtx) {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

function projectUrl(ctx: MentionCtx, path: string) {
  const domain = ctx.site.attributes.internal_domain;
  return domain ? `https://${domain}${environmentPrefix(ctx)}${path}` : null;
}

function createMentionClient(ctx: MentionCtx): Client | null {
  if (!ctx.currentUserAccessToken) return null;
  return buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });
}

type SchemaItemType = Awaited<ReturnType<SchemaRepository['getItemTypeById']>>;
type SchemaField = Awaited<
  ReturnType<SchemaRepository['getItemTypeFields']>
>[number];

function sdkFieldRelationship(field: { id: string } | null | undefined) {
  return {
    data: field ? { id: field.id, type: 'field' as const } : null,
  };
}

function sdkItemTypeFromSchema(itemType: SchemaItemType): ItemType {
  return {
    id: itemType.id,
    type: 'item_type',
    attributes: {
      api_key: itemType.api_key,
      collection_appearance: itemType.collection_appearance,
      modular_block: itemType.modular_block,
      name: itemType.name,
      singleton: itemType.singleton,
    },
    relationships: {
      image_preview_field: sdkFieldRelationship(itemType.image_preview_field),
      presentation_image_field: sdkFieldRelationship(
        itemType.presentation_image_field,
      ),
      presentation_title_field: sdkFieldRelationship(
        itemType.presentation_title_field,
      ),
      title_field: sdkFieldRelationship(itemType.title_field),
    },
  } as unknown as ItemType;
}

function sdkFieldFromSchema(field: SchemaField, itemTypeId: string): Field {
  return {
    id: field.id,
    type: 'field',
    attributes: {
      api_key: field.api_key,
      field_type: field.field_type,
      label: field.label,
      localized: field.localized,
      position: field.position,
    },
    relationships: {
      item_type: {
        data: { id: itemTypeId, type: 'item_type' },
      },
    },
  } as unknown as Field;
}

type LoadedRecordSchema = {
  fields: Field[];
  itemType: ItemType;
  model: ModelInfo;
};

type RecordPresentation = {
  fields: Field[];
  itemType: ItemType | undefined;
  model: ModelInfo;
};

async function recordPresentation({
  itemType,
  loadFields,
  loadMissingSchema,
  model,
  modelId,
}: {
  itemType: ItemType | undefined;
  loadFields: (modelId: string) => Promise<Field[]>;
  loadMissingSchema: (modelId: string) => Promise<LoadedRecordSchema>;
  model: ModelInfo;
  modelId: string;
}): Promise<RecordPresentation> {
  if (modelId === 'unknown') return { fields: [], itemType, model };
  if (!itemType) {
    try {
      return await loadMissingSchema(modelId);
    } catch {
      return { fields: [], itemType, model };
    }
  }

  try {
    return { fields: await loadFields(modelId), itemType, model };
  } catch {
    return { fields: [], itemType, model };
  }
}

function normalizedAssetFilename(
  value: string | undefined,
): string | undefined {
  const filename = [...(value?.trim() ?? '')]
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 ||
        point === 127 ||
        character === '/' ||
        character === '\\'
        ? '-'
        : character;
    })
    .join('')
    .slice(0, 255);
  return filename || undefined;
}

function filenameFromUrl(url: URL): string {
  const encodedBasename = url.pathname.split('/').filter(Boolean).at(-1);
  if (!encodedBasename) return 'download';
  try {
    return (
      normalizedAssetFilename(decodeURIComponent(encodedBasename)) ?? 'download'
    );
  } catch {
    return normalizedAssetFilename(encodedBasename) ?? 'download';
  }
}

async function boundedResponseBlob(
  response: Response,
  maximumBytes: number,
): Promise<Blob> {
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maximumBytes) {
      throw new Error('Assets downloaded from a URL must be 50 MB or smaller.');
    }
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: Each bounded network chunk must be consumed in stream order.
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel();
        throw new Error(
          'Assets downloaded from a URL must be 50 MB or smaller.',
        );
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, {
    type:
      response.headers.get('content-type')?.split(';', 1)[0]?.trim() ||
      'application/octet-stream',
  });
}

async function downloadAssetUrl(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; fallbackFilename: string }> {
  const url = parsePublicAssetUrl(rawUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      // Following a public URL into a private-network redirect would bypass
      // the host check above. Editors can attach redirected files directly.
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'This browser could not download the URL. The server may block cross-origin requests; attach the file from your computer instead.',
    );
  }
  if (!response.ok) {
    throw new Error(
      `The URL could not be downloaded (${response.status} ${response.statusText}).`,
    );
  }

  const declaredSize = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_LOCAL_ASSET_URL_BYTES
  ) {
    void response.body?.cancel();
    throw new Error('Assets downloaded from a URL must be 50 MB or smaller.');
  }

  const blob = await boundedResponseBlob(response, MAX_LOCAL_ASSET_URL_BYTES);
  return { blob, fallbackFilename: filenameFromUrl(url) };
}

function cancelUploadOnAbort<T extends { cancel(): void }>(
  upload: T,
  signal?: AbortSignal,
) {
  if (!signal) return () => undefined;
  const cancel = () => {
    try {
      upload.cancel();
    } catch {
      // Cancellation is best-effort; the promise remains the source of truth.
    }
  };
  if (signal.aborted) cancel();
  else signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

async function confirmAssetCreation(
  ctx: MentionCtx,
  filename: string,
  sourceUrl?: URL,
) {
  const decision = await ctx.openConfirm({
    title: 'Create this asset?',
    content: sourceUrl
      ? `Download “${filename}” from ${sourceUrl.host} and create it in the DatoCMS media area?`
      : `Create “${filename}” in the DatoCMS media area? The attached file itself remains separate from the asset.`,
    choices: [
      {
        label: 'Create asset',
        value: 'create',
        intent: 'positive',
      },
    ],
    cancel: { label: 'Cancel', value: 'cancel' },
  });
  if (decision !== 'create') {
    throw new Error('Asset creation was cancelled.');
  }
}

async function assetCreationSource(
  input: AgentAssetCreationInput,
  signal?: AbortSignal,
): Promise<{ fileOrBlob: File | Blob; filename: string }> {
  if (input.source === 'file') {
    return {
      fileOrBlob: input.fileOrBlob,
      filename: normalizedAssetFilename(input.filename) ?? 'upload',
    };
  }

  const downloaded = await downloadAssetUrl(input.url, signal);
  return {
    fileOrBlob: downloaded.blob,
    filename:
      normalizedAssetFilename(input.filename) ?? downloaded.fallbackFilename,
  };
}

async function createAssetWithClient({
  client,
  ctx,
  input,
  options,
}: {
  client: Client;
  ctx: MentionCtx;
  input: AgentAssetCreationInput;
  options: AgentAssetCreationOptions;
}): Promise<AssetMention> {
  const sourceUrl =
    input.source === 'url' ? parsePublicAssetUrl(input.url) : undefined;
  const filename =
    normalizedAssetFilename(input.filename) ??
    (sourceUrl ? filenameFromUrl(sourceUrl) : 'upload');
  options.signal?.throwIfAborted();
  if (!options.skipConfirmation) {
    // Confirmation deliberately precedes URL fetching so a rejected tool call
    // cannot make a browser-side request merely by presenting the modal.
    await confirmAssetCreation(ctx, filename, sourceUrl);
  }
  options.signal?.throwIfAborted();
  const { fileOrBlob } = await assetCreationSource(input, options.signal);
  options.signal?.throwIfAborted();
  options.onUploadDispatch?.();

  const uploadRequest = client.uploads.createFromFileOrBlob({
    fileOrBlob,
    filename,
  });
  const detachAbort = cancelUploadOnAbort(uploadRequest, options.signal);
  try {
    const upload = await uploadRequest;
    const mimeType = upload.mime_type ?? 'application/octet-stream';
    const url = upload.url ?? '';
    return {
      type: 'asset',
      id: upload.id,
      filename: upload.filename,
      url,
      thumbnailUrl: mentionThumbnailUrl({
        mimeType,
        muxPlaybackId: upload.mux_playback_id,
        url,
        width: 300,
      }),
      mimeType,
    };
  } finally {
    detachAbort();
  }
}

function cmaRecordModelId(record: unknown): string | undefined {
  const itemType = objectValue(objectValue(record).item_type);
  return stringValue(itemType.id) || undefined;
}

function genericRecordTitle(title: string, itemId: string): boolean {
  const normalized = title.trim().toLowerCase().replaceAll('#', '');
  return normalized === `record ${itemId}`.toLowerCase();
}

function usableRecordLabel(label: string | undefined, itemId: string) {
  const normalized = label?.trim() ?? '';
  return normalized && !genericRecordTitle(normalized, itemId)
    ? normalized
    : undefined;
}

function fallbackRecord(
  input: { itemId: string; itemTypeId?: string; label?: string },
  modelsById: ReadonlyMap<string, ModelInfo>,
): RecordMention {
  const model = input.itemTypeId ? modelsById.get(input.itemTypeId) : undefined;
  return fallbackRecordMention({
    id: input.itemId,
    title:
      usableRecordLabel(input.label, input.itemId) ?? `Record #${input.itemId}`,
    ...(model
      ? {
          model: {
            modelId: model.id,
            modelApiKey: model.apiKey,
            modelName: model.name,
            modelEmoji: extractLeadingEmoji(model.name).emoji,
            isSingleton: false,
          },
        }
      : {}),
  });
}

export function createAgentMentionHost(
  ctx: MentionCtx,
  options: {
    currentModelId?: string;
  } = {},
): AgentMentionHost {
  const projectModels = projectModelsFromItemTypes(ctx.itemTypes);
  const recordModels = readableModels(ctx, projectModels);
  const modelsById = new Map(projectModels.map((model) => [model.id, model]));
  const client = createMentionClient(ctx);
  const schemaRepository = client
    ? new SchemaRepository(
        client as ConstructorParameters<typeof SchemaRepository>[0],
      )
    : undefined;
  const assetCreationAllowed = canCreateAssets(ctx);
  const fieldsByModel = new Map<string, Promise<Field[]>>();
  const missingRecordSchemas = new Map<string, Promise<LoadedRecordSchema>>();
  const resolvedRecords = new Map<string, Promise<RecordMention>>();
  const resolvedAssets = new Map<string, Promise<AssetMention>>();
  const initialCurrentUser = currentUserInfo(ctx);
  const projectOwner = ownerInfo(ctx);
  const resolvedUsers = new Map<string, AgentMentionUserInfo>([
    [projectOwner.id, projectOwner],
    [initialCurrentUser.id, initialCurrentUser],
  ]);
  let usersPromise: Promise<AgentMentionUserInfo[]> | undefined;

  const loadRecordFields = (modelId: string) => {
    const cached = fieldsByModel.get(modelId);
    if (cached) return cached;
    const promise = ctx.loadItemTypeFields(modelId).catch((error: unknown) => {
      fieldsByModel.delete(modelId);
      throw error;
    });
    fieldsByModel.set(modelId, promise);
    return promise;
  };

  const loadMissingRecordSchema = (modelId: string) => {
    const cached = missingRecordSchemas.get(modelId);
    if (cached) return cached;
    if (!schemaRepository) {
      return Promise.reject(new Error('Record schema loading is unavailable.'));
    }

    const promise = schemaRepository
      .getItemTypeById(modelId)
      .then(async (schemaItemType) => {
        const schemaFields =
          await schemaRepository.getItemTypeFields(schemaItemType);
        const loaded = {
          itemType: sdkItemTypeFromSchema(schemaItemType),
          fields: schemaFields.map((field) =>
            sdkFieldFromSchema(field, modelId),
          ),
          model: {
            id: schemaItemType.id,
            apiKey: schemaItemType.api_key,
            name: schemaItemType.name,
            isBlockModel: schemaItemType.modular_block,
          },
        } satisfies LoadedRecordSchema;
        modelsById.set(modelId, loaded.model);
        return loaded;
      })
      .catch((error: unknown) => {
        missingRecordSchemas.delete(modelId);
        throw error;
      });
    missingRecordSchemas.set(modelId, promise);
    return promise;
  };

  const resolveRecord = async (input: {
    itemId: string;
    itemTypeId?: string;
    label?: string;
  }): Promise<RecordMention> => {
    if (!client) return fallbackRecord(input, modelsById);

    const cached = resolvedRecords.get(input.itemId);
    if (cached) return cached;

    const resolution = client.items
      .find(input.itemId)
      .then(async (record) => {
        const actualModelId =
          cmaRecordModelId(record) ?? input.itemTypeId ?? 'unknown';
        const fallbackModel = modelsById.get(actualModelId) ?? {
          id: actualModelId,
          apiKey: '',
          name: 'Record',
          isBlockModel: false,
        };
        const presentation = await recordPresentation({
          itemType: ctx.itemTypes[actualModelId],
          loadFields: loadRecordFields,
          loadMissingSchema: loadMissingRecordSchema,
          model: fallbackModel,
          modelId: actualModelId,
        });
        const mention = await createRecordMention({
          client,
          fields: presentation.fields,
          itemType: presentation.itemType,
          mainLocale: ctx.site.attributes.locales[0] ?? 'en',
          model: presentation.model,
          record: {
            id: input.itemId,
            values: objectValue(record),
          },
        });
        const label = usableRecordLabel(input.label, input.itemId);
        return label && genericRecordTitle(mention.title, input.itemId)
          ? { ...mention, title: label }
          : mention;
      })
      .catch((error: unknown) => {
        resolvedRecords.delete(input.itemId);
        throw error;
      });
    resolvedRecords.set(input.itemId, resolution);

    try {
      return await resolution;
    } catch {
      return fallbackRecord(input, modelsById);
    }
  };

  const resolveAsset = async (input: {
    uploadId: string;
    label?: string;
  }): Promise<AssetMention> => {
    if (!client) {
      return fallbackAssetMention(
        input.uploadId,
        input.label?.trim() || `Asset #${input.uploadId}`,
      );
    }

    const cached = resolvedAssets.get(input.uploadId);
    if (cached) return cached;
    const resolution = resolveAssetMention(client, input.uploadId).catch(
      (error: unknown) => {
        resolvedAssets.delete(input.uploadId);
        throw error;
      },
    );
    resolvedAssets.set(input.uploadId, resolution);
    try {
      return await resolution;
    } catch {
      return fallbackAssetMention(
        input.uploadId,
        input.label?.trim() || `Asset #${input.uploadId}`,
      );
    }
  };

  const loadProjectUsers = () => {
    if (usersPromise) return usersPromise;
    usersPromise = Promise.allSettled([ctx.loadUsers(), ctx.loadSsoUsers()])
      .then((results) => {
        if (bothUserLoadsFailed(results[0], results[1])) {
          throw new Error('DatoCMS users could not be loaded.');
        }

        const candidates = [
          ownerInfo(ctx),
          ...regularUsersFromResult(results[0]),
          ...ssoUsersFromResult(results[1]),
        ];
        if (
          !candidates.some(
            (candidate) => candidate.id === initialCurrentUser.id,
          )
        ) {
          candidates.push(initialCurrentUser);
        }
        for (const candidate of candidates) {
          resolvedUsers.set(candidate.id, candidate);
        }
        return candidates;
      })
      .catch((error: unknown) => {
        usersPromise = undefined;
        throw error;
      });
    return usersPromise;
  };

  const createAsset =
    client && assetCreationAllowed
      ? (
          input: AgentAssetCreationInput,
          options: AgentAssetCreationOptions = {},
        ) =>
          createAssetWithClient({ client, ctx, input, options }).then(
            (mention) => {
              resolvedAssets.set(mention.id, Promise.resolve(mention));
              return mention;
            },
          )
      : undefined;

  return {
    currentUser: initialCurrentUser,
    projectOwnerId: projectOwner.id,
    projectModels,
    recordModels,
    canMentionFields: Boolean(options.currentModelId),
    canMentionAssets: canMentionAssets(ctx),
    canMentionModels: canMentionModels(ctx),
    canCreateAssets: assetCreationAllowed,
    loadProjectUsers,
    ...(options.currentModelId
      ? {
          loadModelFields: async () =>
            modelFields(
              await ctx.loadItemTypeFields(options.currentModelId as string),
              ctx.site.attributes.locales,
            ),
        }
      : {}),
    selectAsset: async () => {
      const upload = await ctx.selectUpload({ multiple: false });
      if (!upload) return undefined;
      return createAssetMention(upload);
    },
    selectRecord: async (model) => {
      const selected = await ctx.selectItem(model.id, { multiple: false });
      if (!selected) return undefined;
      const itemType = ctx.itemTypes[model.id];
      let fields: Field[] = [];
      if (itemType) {
        try {
          fields = await loadRecordFields(model.id);
        } catch {
          // A usable record reference does not depend on its display fields.
        }
      }
      const mention = await createRecordMention({
        client,
        fields,
        itemType,
        mainLocale: ctx.site.attributes.locales[0] ?? 'en',
        model,
        record: { id: selected.id, values: selected.attributes },
      });
      resolvedRecords.set(selected.id, Promise.resolve(mention));
      return mention;
    },
    resolveAsset,
    resolveRecord,
    invalidatePresentationCache: () => {
      resolvedRecords.clear();
      resolvedAssets.clear();
    },
    ...(createAsset ? { createAsset } : {}),
    openLocalFile: async (file) => {
      await openFileDetailsModal(ctx, file, hasSessionLocalFileBytes(file.id));
    },
    openUser: (userId) => {
      const user = resolvedUsers.get(userId);
      if (user?.userType === 'owner') return;
      const openDirectory = (resolvedUser?: AgentMentionUserInfo) => {
        if (resolvedUser?.userType === 'owner') return;
        const path =
          resolvedUser?.userType === 'sso'
            ? '/project_settings/sso-users'
            : '/project_settings/users';
        const url = projectUrl(ctx, path);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      };

      if (user) {
        openDirectory(user);
        return;
      }

      // Resolve restored mentions before choosing the regular or SSO screen.
      // Opening the placeholder synchronously preserves the click gesture.
      const popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      void loadProjectUsers()
        .then(() => {
          const resolvedUser = resolvedUsers.get(userId);
          if (!popup || resolvedUser?.userType === 'owner') {
            popup?.close();
            return;
          }
          const path =
            resolvedUser?.userType === 'sso'
              ? '/project_settings/sso-users'
              : '/project_settings/users';
          const url = projectUrl(ctx, path);
          if (url) popup.location.replace(url);
          else popup.close();
        })
        .catch(() => popup?.close());
    },
    openModel: (modelId, isBlockModel) => {
      const path = isBlockModel
        ? `/schema/blocks_library/${encodeURIComponent(modelId)}`
        : `/schema/item_types/${encodeURIComponent(modelId)}`;
      const url = projectUrl(ctx, path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}
