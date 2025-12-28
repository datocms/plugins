/**
 * User Profile Settings Page
 *
 * Allows customization of user display names and profile pictures.
 * These customizations appear everywhere users are displayed in the plugin.
 */

import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { Canvas, Button, Spinner } from 'datocms-react-ui';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  parsePluginParams,
  type UserOverrides,
  type UserOverride,
} from '@utils/pluginParams';
import {
  ownerToUserInfo,
  regularUserToUserInfo,
  ssoUserToUserInfo,
  type UserInfo,
} from '@utils/userTransformers';
import { createUserKey, type UserType } from '@utils/userDisplayResolver';
import { fetchSingleAvatarUrl } from '@hooks/useAvatarUrlCache';
import { logError } from '@/utils/errorLogger';
import UserProfileCard from '@components/UserProfileCard';
import styles from '@styles/userprofilesettings.module.css';

type PropTypes = {
  ctx: RenderPageCtx;
};

/**
 * Extended user info with type information for key generation.
 */
type TypedUser = {
  user: UserInfo;
  userType: UserType;
  compositeKey: string;
};

/**
 * Loading state for the page.
 */
type LoadingState = 'loading' | 'loaded' | 'error';

const UserProfileSettings = ({ ctx }: PropTypes) => {
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);

  // Loading state
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  // User data
  const [regularUsers, setRegularUsers] = useState<TypedUser[]>([]);
  const [ssoUsers, setSsoUsers] = useState<TypedUser[]>([]);
  const [ownerUser, setOwnerUser] = useState<TypedUser | null>(null);

  // Override state (local edits)
  const [localOverrides, setLocalOverrides] = useState<UserOverrides>(
    pluginParams.userOverrides ?? {}
  );

  // Avatar URL cache for displaying custom avatars
  const [avatarCache, setAvatarCache] = useState<Map<string, string>>(new Map());

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Track if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    const original = pluginParams.userOverrides ?? {};
    const current = localOverrides;

    // Check if keys are different
    const originalKeys = Object.keys(original);
    const currentKeys = Object.keys(current);

    if (originalKeys.length !== currentKeys.length) {
      return true;
    }

    // Check if values are different
    for (const key of currentKeys) {
      const origOverride = original[key];
      const currOverride = current[key];

      if (!origOverride) {
        return true;
      }

      if (
        origOverride.nameOverride !== currOverride.nameOverride ||
        origOverride.uploadId !== currOverride.uploadId
      ) {
        return true;
      }
    }

    return false;
  }, [pluginParams.userOverrides, localOverrides]);

  // Build CMA client
  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) return null;
    return buildClient({ apiToken: ctx.currentUserAccessToken });
  }, [ctx.currentUserAccessToken]);

  // Load users on mount
  useEffect(() => {
    const loadUsers = async () => {
      setLoadingState('loading');
      setLoadError(null);

      try {
        // Load regular users and SSO users in parallel
        const [regularResult, ssoResult] = await Promise.allSettled([
          ctx.loadUsers(),
          ctx.loadSsoUsers(),
        ]);

        // Process regular users
        const loadedRegularUsers: TypedUser[] = [];
        if (regularResult.status === 'fulfilled') {
          for (const user of regularResult.value) {
            const userInfo = regularUserToUserInfo(user, 48);
            const compositeKey = createUserKey(userInfo.id, 'user');
            loadedRegularUsers.push({
              user: userInfo,
              userType: 'user',
              compositeKey,
            });
          }
        } else {
          logError('Failed to load regular users', regularResult.reason);
        }

        // Process SSO users
        const loadedSsoUsers: TypedUser[] = [];
        if (ssoResult.status === 'fulfilled') {
          for (const user of ssoResult.value) {
            const userInfo = ssoUserToUserInfo(user, 48);
            const compositeKey = createUserKey(userInfo.id, 'sso');
            loadedSsoUsers.push({
              user: userInfo,
              userType: 'sso',
              compositeKey,
            });
          }
        } else {
          logError('Failed to load SSO users', ssoResult.reason);
        }

        // Process owner
        const ownerInfo = ownerToUserInfo(ctx.owner, 48);
        const ownerType: UserType = ctx.owner.type === 'organization' ? 'org' : 'account';
        const ownerCompositeKey = createUserKey(ownerInfo.id, ownerType);

        setRegularUsers(loadedRegularUsers);
        setSsoUsers(loadedSsoUsers);
        setOwnerUser({
          user: ownerInfo,
          userType: ownerType,
          compositeKey: ownerCompositeKey,
        });

        setLoadingState('loaded');
      } catch (error) {
        logError('Failed to load users', error);
        setLoadError('Failed to load users. Please refresh the page.');
        setLoadingState('error');
      }
    };

    loadUsers();
  }, [ctx]);

  // Load avatar URLs for existing overrides
  useEffect(() => {
    const loadAvatarUrls = async () => {
      if (!client) return;

      const uploadIds = Object.values(localOverrides)
        .map((o) => o.uploadId)
        .filter((id): id is string => !!id);

      if (uploadIds.length === 0) return;

      const newCache = new Map(avatarCache);

      await Promise.all(
        uploadIds.map(async (uploadId) => {
          if (newCache.has(uploadId)) return;

          const url = await fetchSingleAvatarUrl(client, uploadId);
          if (url) {
            newCache.set(uploadId, url);
          }
        })
      );

      setAvatarCache(newCache);
    };

    loadAvatarUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, Object.keys(localOverrides).join(',')]);

  // Update override for a specific user
  const handleOverrideChange = useCallback(
    (compositeKey: string, update: Partial<UserOverride>) => {
      setLocalOverrides((prev) => {
        const existing = prev[compositeKey] ?? {};
        const updated = { ...existing, ...update };

        // Remove empty overrides to save space
        if (!updated.nameOverride && !updated.uploadId) {
          const newOverrides = { ...prev };
          delete newOverrides[compositeKey];
          return newOverrides;
        }

        return {
          ...prev,
          [compositeKey]: updated,
        };
      });
    },
    []
  );

  // Handle avatar selection
  const handleAvatarSelect = useCallback(
    async (compositeKey: string) => {
      try {
        const upload = await ctx.selectUpload({ multiple: false });
        if (!upload) return;

        // Update override with new upload ID
        handleOverrideChange(compositeKey, { uploadId: upload.id });

        // Cache the avatar URL
        const uploadUrl = upload.attributes?.url;
        if (client && uploadUrl) {
          const separator = uploadUrl.includes('?') ? '&' : '?';
          const avatarUrl = `${uploadUrl}${separator}w=96&h=96&fit=crop&auto=format`;
          setAvatarCache((prev) => {
            const newCache = new Map(prev);
            newCache.set(upload.id, avatarUrl);
            return newCache;
          });
        }
      } catch (error) {
        logError('Failed to select avatar', error);
        ctx.alert('Failed to select avatar. Please try again.');
      }
    },
    [ctx, client, handleOverrideChange]
  );

  // Handle avatar removal
  const handleAvatarRemove = useCallback(
    (compositeKey: string) => {
      handleOverrideChange(compositeKey, { uploadId: undefined });
    },
    [handleOverrideChange]
  );

  // Handle name change
  const handleNameChange = useCallback(
    (compositeKey: string, name: string) => {
      // Empty string means remove override
      const nameOverride = name.trim() || undefined;
      handleOverrideChange(compositeKey, { nameOverride });
    },
    [handleOverrideChange]
  );

  // Save changes
  const handleSave = useCallback(async () => {
    setIsSaving(true);

    try {
      // Clean up empty overrides before saving
      const cleanedOverrides: UserOverrides = {};
      for (const [key, override] of Object.entries(localOverrides)) {
        if (override.nameOverride || override.uploadId) {
          cleanedOverrides[key] = override;
        }
      }

      await ctx.updatePluginParameters({
        ...pluginParams,
        userOverrides: Object.keys(cleanedOverrides).length > 0 ? cleanedOverrides : undefined,
      });

      await ctx.notice('User profile settings saved successfully!');
    } catch (error) {
      logError('Failed to save user profile settings', error);
      await ctx.alert('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [ctx, pluginParams, localOverrides]);

  // Reset to saved state
  const handleReset = useCallback(() => {
    setLocalOverrides(pluginParams.userOverrides ?? {});
  }, [pluginParams.userOverrides]);

  // Render loading state
  if (loadingState === 'loading') {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.loadingContainer}>
          <Spinner size={48} />
          <p>Loading users...</p>
        </div>
      </Canvas>
    );
  }

  // Render error state
  if (loadingState === 'error') {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>{loadError}</p>
          <Button onClick={() => window.location.reload()}>Refresh Page</Button>
        </div>
      </Canvas>
    );
  }

  // Combine all users for display
  const allUsers = [...regularUsers, ...ssoUsers];
  if (ownerUser) {
    // Check if owner is already in the list
    const ownerAlreadyIncluded = allUsers.some((u) => u.compositeKey === ownerUser.compositeKey);
    if (!ownerAlreadyIncluded) {
      allUsers.unshift(ownerUser);
    }
  }

  return (
    <Canvas ctx={ctx}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>User Profile Settings</h1>
          <p className={styles.description}>
            Customize how users appear in comments and mentions throughout the project.
            <br />
            Changes apply to all comments and user mentions.
          </p>
        </header>

        {/* Project Owner / Organization */}
        {ownerUser && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {ownerUser.userType === 'org' ? 'Organization' : 'Project Owner'}
            </h2>
            <div className={styles.userGrid}>
              <UserProfileCard
                user={ownerUser.user}
                override={localOverrides[ownerUser.compositeKey]}
                avatarUrl={
                  localOverrides[ownerUser.compositeKey]?.uploadId
                    ? avatarCache.get(localOverrides[ownerUser.compositeKey].uploadId!) ?? null
                    : null
                }
                onNameChange={(name) => handleNameChange(ownerUser.compositeKey, name)}
                onAvatarSelect={() => handleAvatarSelect(ownerUser.compositeKey)}
                onAvatarRemove={() => handleAvatarRemove(ownerUser.compositeKey)}
              />
            </div>
          </section>
        )}

        {/* Regular Users */}
        {regularUsers.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Collaborators ({regularUsers.length})
            </h2>
            <div className={styles.userGrid}>
              {regularUsers.map((typedUser) => (
                <UserProfileCard
                  key={typedUser.compositeKey}
                  user={typedUser.user}
                  override={localOverrides[typedUser.compositeKey]}
                  avatarUrl={
                    localOverrides[typedUser.compositeKey]?.uploadId
                      ? avatarCache.get(localOverrides[typedUser.compositeKey].uploadId!) ?? null
                      : null
                  }
                  onNameChange={(name) => handleNameChange(typedUser.compositeKey, name)}
                  onAvatarSelect={() => handleAvatarSelect(typedUser.compositeKey)}
                  onAvatarRemove={() => handleAvatarRemove(typedUser.compositeKey)}
                />
              ))}
            </div>
          </section>
        )}

        {/* SSO Users */}
        {ssoUsers.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              SSO Users ({ssoUsers.length})
            </h2>
            <div className={styles.userGrid}>
              {ssoUsers.map((typedUser) => (
                <UserProfileCard
                  key={typedUser.compositeKey}
                  user={typedUser.user}
                  override={localOverrides[typedUser.compositeKey]}
                  avatarUrl={
                    localOverrides[typedUser.compositeKey]?.uploadId
                      ? avatarCache.get(localOverrides[typedUser.compositeKey].uploadId!) ?? null
                      : null
                  }
                  onNameChange={(name) => handleNameChange(typedUser.compositeKey, name)}
                  onAvatarSelect={() => handleAvatarSelect(typedUser.compositeKey)}
                  onAvatarRemove={() => handleAvatarRemove(typedUser.compositeKey)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {allUsers.length === 0 && (
          <div className={styles.emptyState}>
            <p>No users found in this project.</p>
          </div>
        )}

        {/* Unsaved changes banner at bottom */}
        {hasUnsavedChanges && (
          <div className={styles.unsavedBanner}>
            <span>You have unsaved changes</span>
            <div className={styles.unsavedActions}>
              <Button
                buttonSize="s"
                buttonType="muted"
                onClick={handleReset}
                disabled={isSaving}
              >
                Reset
              </Button>
              <Button
                buttonSize="s"
                buttonType="primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Canvas>
  );
};

export default UserProfileSettings;
