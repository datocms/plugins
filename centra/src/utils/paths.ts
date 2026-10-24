type PluginSettingsLocation = {
  pluginId: string;
  environment: string;
  isEnvironmentPrimary: boolean;
};

/**
 * The CMS path of the plugin's settings, for a `to`. Outside the primary
 * environment the path carries the environment, as the CMS's own links do.
 */
export function pluginSettingsPath({
  pluginId,
  environment,
  isEnvironmentPrimary,
}: PluginSettingsLocation): string {
  const path = `/configuration/plugins/${pluginId}/edit`;
  return isEnvironmentPrimary ? path : `/environments/${environment}${path}`;
}
