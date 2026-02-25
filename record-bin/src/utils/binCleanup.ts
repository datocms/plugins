import { OnBootCtx } from "datocms-plugin-sdk";
import { automaticBinCleanupObject } from "../types/types";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";
import { getDeploymentUrlFromParameters } from "./getDeploymentUrlFromParameters";

const binCleanup = async (ctx: OnBootCtx) => {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    "binCleanup"
  );

  debugLogger.log("Evaluating daily bin cleanup execution");

  if (ctx.plugin.attributes.parameters.automaticBinCleanup) {
    const deploymentURL = getDeploymentUrlFromParameters(
      ctx.plugin.attributes.parameters
    );
    if (!deploymentURL) {
      debugLogger.warn("Skipping cleanup because deployment URL is missing");
      return;
    }

    const currentTimeStamp = new Date().toISOString().split("T")[0];
    if (
      (
        ctx.plugin.attributes.parameters
          .automaticBinCleanup as automaticBinCleanupObject
      ).timeStamp === currentTimeStamp
    ) {
      debugLogger.log("Skipping cleanup because it already ran today", {
        currentTimeStamp,
      });
      return;
    }

    const requestBody = {
      event_type: "cleanup",
      numberOfDays: (
        ctx.plugin.attributes.parameters
          .automaticBinCleanup as automaticBinCleanupObject
      ).numberOfDays,
      environment: ctx.environment,
    };

    const parsedBody = JSON.stringify(requestBody);
    debugLogger.log("Sending cleanup request", {
      deploymentURL,
      requestBody,
    });

    try {
      const response = await fetch(deploymentURL, {
        method: "POST",
        body: parsedBody,
        headers: { Accept: "*/*", "Content-Type": "application/json" },
      });
      debugLogger.log("Cleanup request finished", { status: response.status });
    } catch (error) {
      debugLogger.error("Cleanup request failed", error);
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
