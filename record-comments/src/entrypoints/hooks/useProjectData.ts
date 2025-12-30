import { useCallback, useMemo } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { loadAllFields } from '@utils/fieldLoader';
import {
  ownerToUserInfo,
  regularUserToUserInfo,
  ssoUserToUserInfo,
  type UserInfo,
} from '@utils/userTransformers';
import type { FieldInfo, ModelInfo } from './useMentions';
import { getValidItemTypes } from '@utils/itemTypeUtils';
import { logError } from '@/utils/errorLogger';
import { useAsyncOperation } from './useAsyncOperation';
import { type UserType, type TypedUserInfo } from '@utils/userDisplayResolver';

type ProjectDataContext = RenderItemFormSidebarCtx | RenderPageCtx;

type UseProjectDataOptions = {
  loadFields?: boolean;
};

type LoadError = {
  source: string;
  message: string;
};

type UseProjectDataReturn = {
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  loadError: LoadError | null;
  retry: () => void;
  /** Users with type information for upvoter name resolution */
  typedUsers: TypedUserInfo[];
};

function isSidebarContext(ctx: ProjectDataContext): ctx is RenderItemFormSidebarCtx {
  return 'itemType' in ctx;
}

export function useProjectData(
  ctx: ProjectDataContext,
  options: UseProjectDataOptions = {}
): UseProjectDataReturn {
  const { loadFields = false } = options;

  const itemTypesStableKey = useMemo(() => {
    const itemTypes = getValidItemTypes(ctx.itemTypes);
    return itemTypes.map((it) => it.id).sort().join(',');
  }, [ctx.itemTypes]);

  const projectModels = useMemo(() => {
    const itemTypes = getValidItemTypes(ctx.itemTypes);
    return itemTypes.map((itemType): ModelInfo => ({
      id: itemType.id,
      apiKey: itemType.attributes.api_key,
      name: itemType.attributes.name,
      isBlockModel: itemType.attributes.modular_block,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemTypesStableKey]);

  const itemTypeId = isSidebarContext(ctx) ? ctx.itemType.id : null;
  const siteId = ctx.site.id;

  const loadFieldsAsync = useCallback(async () => {
    if (!isSidebarContext(ctx)) {
      return [];
    }
    return loadAllFields(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemTypeId]);

  const {
    data: modelFields,
    error: fieldError,
    retry: retryFields,
  } = useAsyncOperation(loadFieldsAsync, [itemTypeId], {
    enabled: loadFields && isSidebarContext(ctx) && itemTypeId !== null,
    operationName: 'load fields',
    errorContext: { itemTypeId },
  });

  const loadUsersAsync = useCallback(async (): Promise<{
    allUsers: UserInfo[];
    typedUsers: TypedUserInfo[];
  }> => {
    const results = await Promise.allSettled([
      ctx.loadUsers(),
      ctx.loadSsoUsers(),
    ]);

    const regularUsersRaw = results[0].status === 'fulfilled' ? results[0].value : [];
    const ssoUsersRaw = results[1].status === 'fulfilled' ? results[1].value : [];

    if (results[0].status === 'rejected') {
      logError('Failed to load regular users', results[0].reason, { siteId });
    }
    if (results[1].status === 'rejected') {
      logError('Failed to load SSO users', results[1].reason, { siteId });
    }

    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      throw new Error('Failed to load users. Please check your connection and try again.');
    }

    const typedUsers: TypedUserInfo[] = [];

    for (const user of regularUsersRaw) {
      const userInfo = regularUserToUserInfo(user, 48);
      typedUsers.push({ user: userInfo, userType: 'user' as UserType });
    }

    for (const user of ssoUsersRaw) {
      const userInfo = ssoUserToUserInfo(user, 48);
      typedUsers.push({ user: userInfo, userType: 'sso' as UserType });
    }

    const ownerInfo = ownerToUserInfo(ctx.owner, 48);
    const ownerType: UserType = ctx.owner.type === 'organization' ? 'org' : 'account';
    const ownerAlreadyIncluded = typedUsers.some((tu) => tu.user.id === ownerInfo.id);
    if (!ownerAlreadyIncluded) {
      typedUsers.unshift({ user: ownerInfo, userType: ownerType });
    }

    const allUsers = typedUsers.map((tu) => tu.user);

    return { allUsers, typedUsers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

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
    [userData]
  );

  const stableTypedUsers = useMemo(
    () => userData?.typedUsers ?? [],
    [userData]
  );

  const stableModelFields = useMemo(
    () => modelFields ?? [],
    [modelFields]
  );

  return {
    projectUsers: stableProjectUsers,
    projectModels,
    modelFields: stableModelFields,
    loadError: currentLoadError,
    retry,
    typedUsers: stableTypedUsers,
  };
}
