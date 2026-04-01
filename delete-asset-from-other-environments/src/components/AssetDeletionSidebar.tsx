import type { EnvironmentInstancesTargetSchema } from '@datocms/cma-client/dist/types/generated/ApiTypes';
import { ApiError, buildClient, LogLevel } from '@datocms/cma-client-browser';
import type { RenderUploadSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import { sortByEnvUpdateTime } from '../utils/sortByEnvUpdateTime.ts';
import { EnvItem } from './EnvItem.tsx';

type EnvUploadLookupResult =
  | { found: true; envId: string }
  | { found: false; envId: string; error?: string };

async function checkUploadExistsInEnv(
  apiToken: string,
  envId: string,
  uploadId: string,
): Promise<EnvUploadLookupResult> {
  const client = buildClient({ apiToken, environment: envId });
  try {
    const upload = await client.uploads.find(uploadId);
    return { found: !!upload, envId };
  } catch (e) {
    if (e instanceof ApiError && e.errors[0]?.attributes.code === 'NOT_FOUND') {
      return { found: false, envId };
    }
    throw e;
  }
}

type EnvDeletionResult =
  | { success: true; envId: string }
  | { success: false; envId: string; error: ApiError | unknown };

async function deleteUploadFromEnv(
  apiToken: string,
  envId: string,
  uploadId: string,
): Promise<EnvDeletionResult> {
  const client = buildClient({ apiToken, environment: envId });
  try {
    await client.uploads.destroy(uploadId);
    return { success: true, envId };
  } catch (e) {
    return { success: false, envId, error: e };
  }
}

export const AssetDeletionSidebar = ({
  ctx,
}: {
  ctx: RenderUploadSidebarPanelCtx;
}) => {
  const {
    currentUserAccessToken,
    currentRole,
    upload: { id: uploadId },
    environment: currentEnv,
    site: {
      id: siteId,
      attributes: { internal_domain },
    },
  } = ctx;

  // TODO add permissions checks
  /*
  "currentRole": {
      "id": "account_role",
      "type": "role",
      "attributes": {
        "name": "Account role",
        "can_edit_site": true,
        "can_edit_schema": true,
        "can_manage_menu": true,
        "can_manage_users": true,
        "can_manage_webhooks": true,
        "can_manage_workflows": true,
        "can_manage_access_tokens": true,
        "can_manage_shared_filters": true,
        "can_manage_upload_collections": true,
        "can_manage_environments": true,
        "can_promote_environments": true,
        "can_manage_sso": true,
        "can_access_audit_log": true,
        "can_edit_environment": true,
        "can_edit_favicon": true,
        "can_manage_build_triggers": true,
        "environments_access": "all",
        "can_perform_site_search": true,
        "can_access_build_events_log": true,
        "positive_item_type_permissions": [
          {
            "item_type": null,
            "workflow": null,
            "on_stage": null,
            "to_stage": null,
            "action": "all",
            "on_creator": "anyone",
            "environment": "main",
            "locale": null,
            "localization_scope": "all"
          }
        ],
        "negative_item_type_permissions": [],
        "positive_upload_permissions": [
          {
            "action": "all",
            "on_creator": "anyone",
            "environment": "main",
            "localization_scope": "all",
            "locale": null
          }
        ],
        "negative_upload_permissions": [],
        "positive_build_trigger_permissions": [
          {
            "build_trigger": null
          }
        ],
        "negative_build_trigger_permissions": []

     */

  const [allOtherEnvsInProject, setAllOtherEnvsInProject] =
    useState<EnvironmentInstancesTargetSchema>([]);
  const [envsWithUpload, setEnvsWithUpload] =
    useState<EnvironmentInstancesTargetSchema>([]);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(
    'Loading...',
  );

  // Build the client once per token.
  const client = useMemo(() => {
    if (!currentUserAccessToken) return null;
    return buildClient({
      apiToken: currentUserAccessToken,
      logLevel: LogLevel.BASIC,
    });
  }, [currentUserAccessToken]);

  useEffect(() => {
    if (!client) return;

    (async () => {
      const discoveredEnvs = await client.environments.list();
      const otherEnvs = discoveredEnvs.filter((env) => env.id !== currentEnv);
      setAllOtherEnvsInProject(otherEnvs);
    })();
  }, [client, currentEnv]);

  useEffect(() => {
    if (!currentUserAccessToken || !allOtherEnvsInProject?.length) {
      return;
    }

    (async () => {
      setLoadingMessage(
        `Checking ${allOtherEnvsInProject.length} environment(s) for this asset...`,
      );

      const lookupResults = await Promise.allSettled(
        allOtherEnvsInProject.map((env) =>
          checkUploadExistsInEnv(currentUserAccessToken, env.id, uploadId),
        ),
      );

      const foundEnvIds = new Set(
        lookupResults
          .filter(
            (r): r is PromiseFulfilledResult<EnvUploadLookupResult> =>
              r.status === 'fulfilled' && r.value.found,
          )
          .map((r) => r.value.envId),
      );

      const rejectedLookups = lookupResults.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      await Promise.all(
        rejectedLookups.map((rejected) => {
          const error = rejected.reason;
          if (error instanceof ApiError) {
            return ctx.alert(
              `Error: ${JSON.stringify(error.errors[0]?.attributes.details)}`,
            );
          }
          return ctx.alert(
            'Unhandled error. Please contact support@datocms.com for help.',
          );
        }),
      );

      const matchingEnvs = allOtherEnvsInProject.filter((env) =>
        foundEnvIds.has(env.id),
      );

      setEnvsWithUpload(matchingEnvs.sort(sortByEnvUpdateTime));
      setLoadingMessage(null);
    })();
  }, [allOtherEnvsInProject, currentUserAccessToken, uploadId, ctx.alert]);

  // TODO permissions
  // Exit early if missing permissions
  if (
    !currentUserAccessToken ||
    !currentRole ||
    currentRole?.attributes.environments_access !== 'all'
  ) {
    return (
      <Canvas ctx={ctx}>
        <p>
          You do not have the right permissions to run this plugin. Please check
          with your admin.
        </p>
      </Canvas>
    );
  }

  const handleDeletionResults = async (
    results: PromiseSettledResult<EnvDeletionResult>[],
  ) => {
    const failedResults = results
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<
          EnvDeletionResult & { success: false }
        > => r.status === 'fulfilled' && !r.value.success,
      )
      .map((r) => r.value);

    const rejectedResults = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    await Promise.all(
      failedResults.map((failed) => {
        if (failed.error instanceof ApiError) {
          return ctx.alert(
            `Error: ${JSON.stringify(failed.error.errors[0]?.attributes.details)}`,
          );
        }
        return ctx.alert(
          'Unhandled error. Please contact support@datocms.com for help.',
        );
      }),
    );

    await Promise.all(
      rejectedResults.map((rejected) =>
        ctx.alert(
          `Unhandled error: ${rejected.reason}. Please contact support@datocms.com for help.`,
        ),
      ),
    );

    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;

    return successCount;
  };

  const deleteFromAllEnvs = async () => {
    const userConfirmed = await ctx.openConfirm({
      title: `Delete ${envsWithUpload.length} other copies?`,
      content: `Are you sure? This will delete the asset from ${envsWithUpload.length} other environments. Then you'll still have to manually delete this last copy in the current environment.`,
      choices: [
        {
          label: 'Delete all',
          value: 'deleteAll',
          intent: 'negative',
        },
      ],
      cancel: { label: 'Go back', value: 'cancel' },
    });

    if (userConfirmed !== 'deleteAll') {
      return;
    }

    setLoadingMessage(`Deleting from ${envsWithUpload.length} environments...`);

    const deletionResults = await Promise.allSettled(
      envsWithUpload.map((env) =>
        deleteUploadFromEnv(currentUserAccessToken, env.id, uploadId),
      ),
    );

    const copiesDeleted = await handleDeletionResults(deletionResults);

    ctx.notice(
      `Deleted ${copiesDeleted} other copies. You must delete the last copy in the current environment manually.`,
    );
    window.location.href = '/';
    setLoadingMessage(null);
  };

  if (loadingMessage?.length) {
    return (
      <Canvas ctx={ctx}>
        <strong>
          <Spinner size={20} />
          {loadingMessage}
        </strong>
        <p>Please wait...</p>
      </Canvas>
    );
  }

  if (envsWithUpload.length === 0) {
    return (
      <Canvas ctx={ctx}>
        <p>
          This is the last remaining copy of this asset.{' '}
          <strong>
            You must delete it manually using the regular "Delete" link at the
            top of this sidebar.
          </strong>
        </p>
        <p>This is a safety measure, sorry!</p>
        <p>
          <strong>
            Once you delete this final copy, the asset should disappear from our
            CDN (datocms-assets.com) within 24 hours.
          </strong>
        </p>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <p>Asset found in {envsWithUpload.length} other environment(s):</p>
      <ol>
        {envsWithUpload.map((env) => (
          <EnvItem
            key={uploadId}
            env={env}
            currentEnv={currentEnv}
            uploadId={uploadId}
            projectDomain={internal_domain ?? `${siteId}.admin.datocms.com`}
          />
        ))}
      </ol>
      <Button onClick={deleteFromAllEnvs}>
        Delete this asset from {envsWithUpload.length} other env(s)
      </Button>
    </Canvas>
  );
};
