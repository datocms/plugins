import { Button, Canvas, Spinner } from "datocms-react-ui";
import type { RenderUploadSidebarPanelCtx } from "datocms-plugin-sdk";
import { useEffect, useMemo, useState } from "react";
import { ApiError, buildClient, LogLevel } from "@datocms/cma-client-browser";
import type { EnvironmentInstancesTargetSchema } from "@datocms/cma-client/dist/types/generated/ApiTypes";
import { EnvItem } from "./EnvItem.tsx";
import { sortByEnvUpdateTime } from "../utils/sortByEnvUpdateTime.ts";

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
    "Loading...",
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
  }, [client]);

  useEffect(() => {
    if (
      !currentUserAccessToken ||
      !allOtherEnvsInProject ||
      !allOtherEnvsInProject.length
    ) {
      return;
    }

    (async () => {
      setLoadingMessage(
        `Checking ${allOtherEnvsInProject.length} environment(s) for this asset...`,
      );
      let envsWithUpload: EnvironmentInstancesTargetSchema = [];
      const lookups = allOtherEnvsInProject.map(async (env) => {
        const client = buildClient({
          apiToken: currentUserAccessToken,
          environment: env.id,
        });

        try {
          const upload = await client.uploads.find(uploadId);
          if (upload) {
            envsWithUpload.push(env);
          }
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.errors[0].attributes.code === "NOT_FOUND") {
              // Do nothing; that env just doesn't have this image (expected behavior)
              return;
            } else {
              await ctx.alert(
                `Error: ${JSON.stringify(e.errors[0].attributes.details)}`,
              );
              return;
            }
          } else {
            await ctx.alert(
              `Unhandled error. Please contact support@datocms.com for help.`,
            );
            //@ts-expect-error The cause should be valid
            throw new Error("Unhandled error", { cause: e });
          }
        }
      });

      await Promise.all(lookups);
      setEnvsWithUpload(envsWithUpload.sort(sortByEnvUpdateTime));
      setLoadingMessage(null);
    })();
  }, [allOtherEnvsInProject, currentUserAccessToken, uploadId]);

  // TODO permissions
  // Exit early if missing permissions
  if (!currentUserAccessToken || !currentRole || currentRole?.attributes.environments_access !== 'all') {
    return (
      <Canvas ctx={ctx}>
        <p>
          You do not have the right permissions to run this plugin. Please check
          with your admin.
        </p>
      </Canvas>
    );
  }

  const deleteFromAllEnvs = async () => {
    const confirm = (await ctx.openConfirm({
      title: `Delete ${envsWithUpload.length} other copies?`,
      content: `Are you sure? This will delete the asset from ${envsWithUpload.length} other environments. Then you'll still have to manually delete this last copy in the current environment.`,
      choices: [
        {
          label: "Delete all",
          value: "deleteAll",
          intent: "negative",
        },
      ],
      cancel: { label: "Go back", value: "cancel" },
    })) as unknown as "deleteAll" | "cancel";

    if (confirm === "deleteAll") {
      setLoadingMessage(
        `Deleting from ${envsWithUpload.length} environments...`,
      );

      let copiesDeleted: number = 0;

      for (const env of envsWithUpload) {
        try {
          const client = buildClient({
            apiToken: currentUserAccessToken,
            environment: env.id,
          });
          const deletionAttempt = await client.uploads.destroy(uploadId);
          if (deletionAttempt) {
            copiesDeleted++;
          }
        } catch (e) {
          if (e instanceof ApiError) {
            await ctx.alert(
              `Error: ${JSON.stringify(e.errors[0].attributes.details)}`,
            );
            return;
          } else {
            await ctx.alert(
              `Unhandled error. Please contact support@datocms.com for help.`,
            );
            //@ts-expect-error The cause should be valid
            throw new Error("Unhandled error", { cause: e });
          }
        }
      }

      ctx.notice(
        `Deleted ${copiesDeleted} other copies. You must delete the last copy in the current environment manually.`,
      );
      window.location.href = "/";
      setLoadingMessage(null);
    }
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
          This is the last remaining copy of this asset.{" "}
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
