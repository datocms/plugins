type PluginParameters = Record<string, unknown> | undefined;

const isString = (value: unknown): value is string => typeof value === 'string';

export const getDeploymentUrlFromParameters = (
  parameters: PluginParameters,
): string => {
  if (!parameters) {
    return '';
  }

  if (isString(parameters.deploymentURL) && parameters.deploymentURL.trim()) {
    return parameters.deploymentURL;
  }

  if (isString(parameters.vercelURL)) {
    return parameters.vercelURL;
  }

  return '';
};
