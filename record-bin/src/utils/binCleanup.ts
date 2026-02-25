import { OnBootCtx } from "datocms-plugin-sdk";
import { automaticBinCleanupObject } from "../types/types";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";
import { getDeploymentUrlFromParameters } from "./getDeploymentUrlFromParameters";
import { getRuntimeMode } from "./getRuntimeMode";
import { cleanupRecordBinWithoutLambda } from "./lambdaLessCleanup";

const binCleanup = async (ctx: OnBootCtx) => {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    "binCleanup"
  );

  debugLogger.log("Evaluating daily bin cleanup execution");

  if (ctx.plugin.attributes.parameters.automaticBinCleanup) {
    const currentTimeStamp = new Date().toISOString().split("T")[0];
    const cleanupSettings = ctx.plugin.attributes.parameters
      .automaticBinCleanup as automaticBinCleanupObject;
    if (
      cleanupSettings.timeStamp === currentTimeStamp
    ) {
      debugLogger.log("Skipping cleanup because it already ran today", {
        currentTimeStamp,
      });
      return;
    }

    const runtimeMode = getRuntimeMode(ctx.plugin.attributes.parameters);

    if (runtimeMode === "lambda") {
      const deploymentURL = getDeploymentUrlFromParameters(
        ctx.plugin.attributes.parameters
      );
      if (!deploymentURL) {
        debugLogger.warn("Skipping cleanup because deployment URL is missing");
        return;
      }

      const requestBody = {
        event_type: "cleanup",
        numberOfDays: cleanupSettings.numberOfDays,
        environment: ctx.environment,
      };
      const parsedBody = JSON.stringify(requestBody);

      debugLogger.log("Sending lambda cleanup request", {
        deploymentURL,
        requestBody,
      });

      try {
        const response = await fetch(deploymentURL, {
          method: "POST",
          body: parsedBody,
          headers: { Accept: "*/*", "Content-Type": "application/json" },
        });
        debugLogger.log("Lambda cleanup request finished", {
          status: response.status,
        });
      } catch (error) {
        debugLogger.error("Lambda cleanup request failed", error);
      }
    } else {
      debugLogger.log("Running cleanup in Lambda-less mode");

      try {
        const cleanupResult = await cleanupRecordBinWithoutLambda({
          currentUserAccessToken: ctx.currentUserAccessToken,
          environment: ctx.environment,
          numberOfDays: cleanupSettings.numberOfDays,
        });
        debugLogger.log("Lambda-less cleanup finished", cleanupResult);
      } catch (error) {
        debugLogger.error("Lambda-less cleanup failed", error);
      }
    }

    const newParameters = { ...ctx.plugin.attributes.parameters };
    (newParameters.automaticBinCleanup as automaticBinCleanupObject).timeStamp =
      currentTimeStamp;
    await ctx.updatePluginParameters(newParameters);
    debugLogger.log("Cleanup timestamp persisted", { currentTimeStamp });
    return;
  }

  debugLogger.log("Skipping cleanup because automatic cleanup is disabled");
};

export default binCleanup;
