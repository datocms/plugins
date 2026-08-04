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
import type { AssetMention, RecordMention } from './mentions';

type MentionCtx = RenderInspectorCtx | RenderItemFormSidebarCtx;

export type AgentMentionUserInfo = UserInfo & {
  userType: 'user' | 'sso' | 'owner';
};

export type AgentMentionHost = {
  currentUser: AgentMentionUserInfo;
  projectModels: ModelInfo[];
  recordModels: ModelInfo[];
  canMentionFields: boolean;
  canMentionAssets: boolean;
  canMentionModels: boolean;
  loadProjectUsers: () => Promise<AgentMentionUserInfo[]>;
  loadModelFields?: () => Promise<FieldInfo[]>;
  selectAsset: () => Promise<AssetMention | undefined>;
  selectRecord: (model: ModelInfo) => Promise<RecordMention | undefined>;
  openUser: (userId: string) => void | Promise<void>;
  openModel: (modelId: string, isBlockModel: boolean) => void;
};

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
        fieldType: field.attributes.field_type,
        // The agent composer intentionally references nested containers as a
        // whole. It never attempts to inspect unsaved block structure here.
        isBlockContainer: false,
      }),
    );
}

function localizedString(value: unknown, locales: readonly string[]) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const candidate = objectValue(value);
  for (const locale of locales) {
    const localized = candidate[locale];
    if (typeof localized === 'string' && localized.trim()) {
      return localized.trim();
    }
  }
  return '';
}

function recordTitle({
  record,
  itemType,
  fields,
  locales,
  modelName,
}: {
  record: { id: string; attributes: Record<string, unknown> };
  itemType: ItemType | undefined;
  fields: readonly Field[];
  locales: readonly string[];
  modelName: string;
}) {
  if (itemType?.attributes.singleton) return modelName;
  const titleFieldId =
    itemType?.relationships.presentation_title_field.data?.id ??
    itemType?.relationships.title_field.data?.id;
  const titleField = fields.find((field) => field.id === titleFieldId);
  if (titleField) {
    const title = localizedString(
      record.attributes[titleField.attributes.api_key],
      locales,
    );
    if (title) return title;
  }

  for (const field of fields) {
    const value = localizedString(
      record.attributes[field.attributes.api_key],
      locales,
    );
    if (value) return value;
  }

  return `Record #${record.id}`;
}

function assetThumbnail(
  mimeType: string,
  url: string,
  muxPlaybackId: string,
): string | null {
  if (mimeType.startsWith('image/') && url) {
    return `${url}?w=300&fit=max&auto=format&dpr=2&q=80`;
  }
  if (mimeType.startsWith('video/') && muxPlaybackId) {
    return `https://image.mux.com/${muxPlaybackId}/thumbnail.jpg?width=300&fit_mode=preserve`;
  }
  return null;
}

function environmentPrefix(ctx: MentionCtx) {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

function projectUrl(ctx: MentionCtx, path: string) {
  const domain = ctx.site.attributes.internal_domain;
  return domain ? `https://${domain}${environmentPrefix(ctx)}${path}` : null;
}

export function createAgentMentionHost(
  ctx: MentionCtx,
  options: {
    currentModelId?: string;
  } = {},
): AgentMentionHost {
  const projectModels = projectModelsFromItemTypes(ctx.itemTypes);
  const recordModels = readableModels(ctx, projectModels);
  const initialCurrentUser = currentUserInfo(ctx);
  const resolvedUsers = new Map<string, AgentMentionUserInfo>([
    [ownerInfo(ctx).id, ownerInfo(ctx)],
    [initialCurrentUser.id, initialCurrentUser],
  ]);
  let usersPromise: Promise<AgentMentionUserInfo[]> | undefined;

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

  return {
    currentUser: initialCurrentUser,
    projectModels,
    recordModels,
    canMentionFields: Boolean(options.currentModelId),
    canMentionAssets: canMentionAssets(ctx),
    canMentionModels: canMentionModels(ctx),
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
      const mimeType =
        upload.attributes.mime_type ?? 'application/octet-stream';
      const url = upload.attributes.url ?? '';
      return {
        type: 'asset',
        id: upload.id,
        filename: upload.attributes.filename,
        url,
        thumbnailUrl: assetThumbnail(
          mimeType,
          url,
          upload.attributes.mux_playback_id ?? '',
        ),
        mimeType,
      };
    },
    selectRecord: async (model) => {
      const selected = await ctx.selectItem(model.id, { multiple: false });
      if (!selected) return undefined;
      const itemType = ctx.itemTypes[model.id];
      let fields: Field[] = [];
      if (itemType) {
        try {
          fields = await ctx.loadItemTypeFields(model.id);
        } catch {
          // A usable record reference does not depend on its display fields.
        }
      }
      const title = recordTitle({
        record: { id: selected.id, attributes: selected.attributes },
        itemType,
        fields,
        locales: ctx.site.attributes.locales,
        modelName: model.name,
      });
      return {
        type: 'record',
        id: selected.id,
        title,
        modelId: model.id,
        modelApiKey: model.apiKey,
        modelName: model.name,
        modelEmoji: extractLeadingEmoji(model.name).emoji,
        thumbnailUrl: null,
        ...(itemType?.attributes.singleton ? { isSingleton: true } : {}),
      };
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
