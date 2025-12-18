import { OnBootPropertiesAndMethods } from "datocms-plugin-sdk";
import { automaticBinCleanupObject } from "../types/types";

const binCleanup = async (ctx: OnBootPropertiesAndMethods) => {
  if (ctx.plugin.attributes.parameters.automaticBinCleanup) {
    const currentTimeStamp = new Date().toISOString().split("T")[0];
    if (
      (
        ctx.plugin.attributes.parameters
          .automaticBinCleanup as automaticBinCleanupObject
      ).timeStamp === currentTimeStamp
    ) {
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

    try {
      await fetch(ctx.plugin.attributes.parameters.vercelURL as URL, {
        method: "POST",
        body: parsedBody,
        headers: { Accept: "*/*", "Content-Type": "application/json" },
      });
    } catch {}

    const newParameters = { ...ctx.plugin.attributes.parameters };
    (newParameters.automaticBinCleanup as automaticBinCleanupObject).timeStamp =
      currentTimeStamp;

    await ctx.updatePluginParameters(newParameters);
  }
};

export default binCleanup;
