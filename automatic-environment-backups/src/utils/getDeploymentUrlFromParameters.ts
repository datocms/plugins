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

  if (isString(parameters.netlifyURL) && parameters.netlifyURL.trim()) {
    return parameters.netlifyURL;
  }

  if (isString(parameters.vercelURL) && parameters.vercelURL.trim()) {
    return parameters.vercelURL;
  }

  return '';
};
