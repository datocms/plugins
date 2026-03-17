export type PluginParameters = {
  cdaToken: string;
  commentsModelIdsByEnvironment: Record<string, string>;
  debugLoggingEnabled: boolean;
  migrationCompleted: boolean;
  realTimeUpdatesEnabled: boolean;
};

export const PLUGIN_PARAMS_DEFAULTS: PluginParameters = {
  cdaToken: '',
  commentsModelIdsByEnvironment: {},
  debugLoggingEnabled: false,
  migrationCompleted: false,
  realTimeUpdatesEnabled: true,
};

function parseString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function parseTrimmedString(value: unknown, fallback: string) {
  return parseString(value, fallback).trim();
}

function parseBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function parseCommentsModelIdsByEnvironment(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([environment, modelId]) => {
      if (typeof modelId !== 'string') {
        return [];
      }

      const trimmedModelId = modelId.trim();
      if (!trimmedModelId) {
        return [];
      }

      return [[environment, trimmedModelId]];
    })
  );
}

export function parsePluginParams(params: unknown): PluginParameters {
  if (!params || typeof params !== 'object') {
    return { ...PLUGIN_PARAMS_DEFAULTS };
  }

  const rawParams = params as Record<string, unknown>;

  return {
    cdaToken: parseTrimmedString(rawParams.cdaToken, PLUGIN_PARAMS_DEFAULTS.cdaToken),
    commentsModelIdsByEnvironment: parseCommentsModelIdsByEnvironment(
      rawParams.commentsModelIdsByEnvironment
    ),
    debugLoggingEnabled: parseBoolean(
      rawParams.debugLoggingEnabled,
      PLUGIN_PARAMS_DEFAULTS.debugLoggingEnabled
    ),
    migrationCompleted: parseBoolean(
      rawParams.migrationCompleted,
      PLUGIN_PARAMS_DEFAULTS.migrationCompleted
    ),
    realTimeUpdatesEnabled: parseBoolean(
      rawParams.realTimeUpdatesEnabled,
      PLUGIN_PARAMS_DEFAULTS.realTimeUpdatesEnabled
    ),
  };
}

export function buildPluginParams(params: Partial<PluginParameters>): PluginParameters {
  return {
    cdaToken: parseTrimmedString(params.cdaToken, PLUGIN_PARAMS_DEFAULTS.cdaToken),
    commentsModelIdsByEnvironment: parseCommentsModelIdsByEnvironment(
      params.commentsModelIdsByEnvironment
    ),
    debugLoggingEnabled: parseBoolean(
      params.debugLoggingEnabled,
      PLUGIN_PARAMS_DEFAULTS.debugLoggingEnabled
    ),
    migrationCompleted: parseBoolean(
      params.migrationCompleted,
      PLUGIN_PARAMS_DEFAULTS.migrationCompleted
    ),
    realTimeUpdatesEnabled: parseBoolean(
      params.realTimeUpdatesEnabled,
      PLUGIN_PARAMS_DEFAULTS.realTimeUpdatesEnabled
    ),
  };
}

export function getCommentsModelIdForEnvironment(
  params: PluginParameters,
  environment: string
): string | null {
  return params.commentsModelIdsByEnvironment[environment] ?? null;
}

export function setCommentsModelIdForEnvironment(
  params: PluginParameters,
  environment: string,
  modelId: string
): PluginParameters {
  return buildPluginParams({
    ...params,
    commentsModelIdsByEnvironment: {
      ...params.commentsModelIdsByEnvironment,
      [environment]: modelId,
    },
  });
}
