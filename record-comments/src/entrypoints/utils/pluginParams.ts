export type PluginParameters = {
  cdaToken?: string;
  migrationCompleted?: boolean;
  realTimeUpdatesEnabled?: boolean;
  dashboardEnabled?: boolean;
  notificationsEndpoint?: string;
};

const PLUGIN_PARAMS_DEFAULTS = {
  cdaToken: '',
  migrationCompleted: false,
  realTimeUpdatesEnabled: true,
  dashboardEnabled: true,
  notificationsEndpoint: '',
} as const;

function parseString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function parseBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

export function parsePluginParams(params: unknown): PluginParameters {
  if (!params || typeof params !== 'object') {
    return { ...PLUGIN_PARAMS_DEFAULTS };
  }

  const rawParams = params as Record<string, unknown>;

  return {
    cdaToken: parseString(rawParams.cdaToken, PLUGIN_PARAMS_DEFAULTS.cdaToken),
    migrationCompleted: parseBoolean(rawParams.migrationCompleted, PLUGIN_PARAMS_DEFAULTS.migrationCompleted),
    realTimeUpdatesEnabled: parseBoolean(rawParams.realTimeUpdatesEnabled, PLUGIN_PARAMS_DEFAULTS.realTimeUpdatesEnabled),
    dashboardEnabled: parseBoolean(rawParams.dashboardEnabled, PLUGIN_PARAMS_DEFAULTS.dashboardEnabled),
    notificationsEndpoint: parseString(rawParams.notificationsEndpoint, PLUGIN_PARAMS_DEFAULTS.notificationsEndpoint),
  };
}

export function hasCdaToken(params: PluginParameters): boolean {
  return typeof params.cdaToken === 'string' && params.cdaToken.length > 0;
}
