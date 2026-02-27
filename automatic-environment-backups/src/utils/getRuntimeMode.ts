import { getDeploymentUrlFromParameters } from "./getDeploymentUrlFromParameters";
import { RuntimeMode } from "../types/types";

type PluginParameters = Record<string, unknown> | undefined;

const isRuntimeMode = (value: unknown): value is RuntimeMode =>
  value === "lambda" || value === "lambdaless";

export const getRuntimeMode = (parameters: PluginParameters): RuntimeMode => {
  const configuredRuntimeMode = parameters?.runtimeMode;
  if (isRuntimeMode(configuredRuntimeMode)) {
    return configuredRuntimeMode;
  }

  if (typeof parameters?.lambdaFullMode === "boolean") {
    return parameters.lambdaFullMode ? "lambda" : "lambdaless";
  }

  return getDeploymentUrlFromParameters(parameters).trim()
    ? "lambda"
    : "lambdaless";
};
