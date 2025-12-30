export type PluginParameters = {
  cdaToken?: string;
  migrationCompleted?: boolean;
  realTimeUpdatesEnabled?: boolean;
  dashboardEnabled?: boolean;
};

const PLUGIN_PARAMS_DEFAULTS = {
  cdaToken: '',
  migrationCompleted: false,
  realTimeUpdatesEnabled: true,
  dashboardEnabled: true,
};

export function parsePluginParams(params: unknown): PluginParameters {
  if (!params || typeof params !== 'object') {
    return { ...PLUGIN_PARAMS_DEFAULTS };
  }

  const rawParams = params as Record<string, unknown>;

  return {
    cdaToken:
      typeof rawParams.cdaToken === 'string'
        ? rawParams.cdaToken
        : PLUGIN_PARAMS_DEFAULTS.cdaToken,
    migrationCompleted:
      typeof rawParams.migrationCompleted === 'boolean'
        ? rawParams.migrationCompleted
        : PLUGIN_PARAMS_DEFAULTS.migrationCompleted,
    realTimeUpdatesEnabled:
      typeof rawParams.realTimeUpdatesEnabled === 'boolean'
        ? rawParams.realTimeUpdatesEnabled
        : PLUGIN_PARAMS_DEFAULTS.realTimeUpdatesEnabled,
    dashboardEnabled:
      typeof rawParams.dashboardEnabled === 'boolean'
        ? rawParams.dashboardEnabled
        : PLUGIN_PARAMS_DEFAULTS.dashboardEnabled,
  };
}

export function hasCdaToken(params: PluginParameters): boolean {
  return typeof params.cdaToken === 'string' && params.cdaToken.length > 0;
}
