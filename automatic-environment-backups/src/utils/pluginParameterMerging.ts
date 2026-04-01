const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toPluginParameterRecord = (
  value: unknown,
): Record<string, unknown> => {
  return isObject(value) ? { ...value } : {};
};

export const mergePluginParameterUpdates = (
  latestParameters: unknown,
  updates: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    ...toPluginParameterRecord(latestParameters),
    ...updates,
  };
};
