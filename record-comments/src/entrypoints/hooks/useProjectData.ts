import { loadAllFields } from '@utils/fieldLoader';
import { getValidItemTypes } from '@utils/itemTypeUtils';
import type { TypedUserInfo } from '@utils/userDisplayResolver';
import {
  currentUserToUserInfo,
  ownerToUserInfo,
  regularUserToUserInfo,
  ssoUserToUserInfo,
  type UserInfo,
} from '@utils/userTransformers';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCallback, useMemo } from 'react';
import { logError } from '@/utils/errorLogger';
import { useAsyncOperation } from './useAsyncOperation';
import type { FieldInfo, ModelInfo } from './useMentions';

type UseProjectDataOptions = {
  loadFields?: boolean;
  fieldsRequestKey?: number;
};

type LoadError = {
  source: string;
  message: string;
};

type UseProjectDataReturn = {
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  isLoadingFields: boolean;
  fieldLoadError: LoadError | null;
  loadError: LoadError | null;
  retry: () => void;
  retryFields: () => void;
  /** Users with type information for upvoter name resolution */
  typedUsers: TypedUserInfo[];
};

export function useProjectData(
  ctx: RenderItemFormSidebarCtx,
  options: UseProjectDataOptions = {},
): UseProjectDataReturn {
  const { loadFields = false, fieldsRequestKey = 0 } = options;

  const projectModels = useMemo(() => {
    const itemTypes = getValidItemTypes(ctx.itemTypes);
    return itemTypes.map(
      (itemType): ModelInfo => ({
        id: itemType.id,
        apiKey: itemType.attributes.api_key,
        name: itemType.attributes.name,
        isBlockModel: itemType.attributes.modular_block,
      }),
    );
  }, [ctx.itemTypes]);

  const itemTypeId = ctx.itemType.id;
  const siteId = ctx.site.id;
  const localesStableKey = useMemo(
    () => ctx.site.attributes.locales.join(','),
    [ctx.site.attributes.locales],
  );
  const loadFieldsAsync = useCallback(async () => {
    return loadAllFields(ctx);
  }, [ctx]);

  const {
    data: modelFields,
    isLoading: isLoadingFields,
    error: fieldError,
    retry: retryFields,
  } = useAsyncOperation(
    loadFieldsAsync,
    [itemTypeId, fieldsRequestKey, localesStableKey],
    {
      enabled: loadFields,
      operationName: 'load fields',
      errorContext: { itemTypeId },
    },
  );

  const buildTypedUsersFromRaw = useCallback(
    (
      regularUsersRaw: Awaited<ReturnType<typeof ctx.loadUsers>>,
      ssoUsersRaw: Awaited<ReturnType<typeof ctx.loadSsoUsers>>,
    ): TypedUserInfo[] => {
      const typedUsers: TypedUserInfo[] = [];

      for (const user of regularUsersRaw) {
        const userInfo = regularUserToUserInfo(user, 48);
        typedUsers.push({ user: userInfo, userType: 'user' });
      }

      for (const user of ssoUsersRaw) {
        const userInfo = ssoUserToUserInfo(user, 48);
        typedUsers.push({ user: userInfo, userType: 'sso' });
      }

      return typedUsers;
    },
    [],
  );

  const prependOwnerAndCurrentUser = useCallback(
    (typedUsers: TypedUserInfo[]): void => {
      const ownerInfo = ownerToUserInfo(ctx.owner, 48);
      const ownerType =
        ctx.owner.type === 'organization' ? 'org' : ('account' as const);
      const ownerAlreadyIncluded = typedUsers.some(
        (tu) => tu.user.id === ownerInfo.id,
      );
      if (!ownerAlreadyIncluded) {
        typedUsers.unshift({ user: ownerInfo, userType: ownerType });
      }

      const currentUserAlreadyIncluded = typedUsers.some(
        (tu) => tu.user.id === ctx.currentUser.id,
      );
      if (!currentUserAlreadyIncluded) {
        const currentUserInfo = currentUserToUserInfo(ctx.currentUser, 48);
        typedUsers.unshift({ user: currentUserInfo, userType: 'user' });
      }
    },
    [ctx.currentUser, ctx.owner],
  );

  const loadUsersAsync = useCallback(async (): Promise<{
    allUsers: UserInfo[];
    typedUsers: TypedUserInfo[];
  }> => {
    const results = await Promise.allSettled([
      ctx.loadUsers(),
      ctx.loadSsoUsers(),
    ]);

    const regularUsersRaw =
      results[0].status === 'fulfilled' ? results[0].value : [];
    const ssoUsersRaw =
      results[1].status === 'fulfilled' ? results[1].value : [];

    if (results[0].status === 'rejected') {
      logError('Failed to load regular users', results[0].reason, { siteId });
    }
    if (results[1].status === 'rejected') {
      logError('Failed to load SSO users', results[1].reason, { siteId });
    }

    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      throw new Error(
        'Failed to load users. Please check your connection and try again.',
      );
    }

    const typedUsers = buildTypedUsersFromRaw(regularUsersRaw, ssoUsersRaw);
    prependOwnerAndCurrentUser(typedUsers);

    const allUsers = typedUsers.map((tu) => tu.user);

    return { allUsers, typedUsers };
  }, [
    siteId,
    ctx.loadSsoUsers,
    ctx.loadUsers,
    buildTypedUsersFromRaw,
    prependOwnerAndCurrentUser,
  ]);

  const {
    data: userData,
    error: userError,
    retry: retryUsers,
  } = useAsyncOperation(loadUsersAsync, [siteId], {
    enabled: true,
    operationName: 'load users',
    errorContext: { siteId },
  });

  const retry = useCallback(() => {
    retryFields();
    retryUsers();
  }, [retryFields, retryUsers]);

  const currentLoadError = fieldError || userError;

  const stableProjectUsers = useMemo(
    () => userData?.allUsers ?? [],
    [userData],
  );

  const stableTypedUsers = useMemo(
    () => userData?.typedUsers ?? [],
    [userData],
  );

  const stableModelFields = useMemo(() => modelFields ?? [], [modelFields]);

  return {
    projectUsers: stableProjectUsers,
    projectModels,
    modelFields: stableModelFields,
    isLoadingFields,
    fieldLoadError: fieldError,
    loadError: currentLoadError,
    retry,
    retryFields,
    typedUsers: stableTypedUsers,
  };
}
