import { cmaClient } from '../setup/cma';
import { resolvePluginId } from '../setup/plugin-params';

/**
 * Read/write the AI Translations plugin's parameters in one forked env — the
 * lever behind the surface-gating tests (exclusions, feature toggles, blanked
 * credentials). Every mutating test MUST restore the snapshot it took (use
 * try/finally): later tests in the same lane rely on the lane's real params.
 */

/** Snapshot the plugin's current parameters in an environment. */
export const getPluginParams = async (
  envName: string,
): Promise<Record<string, unknown>> => {
  const pluginId = await resolvePluginId();
  const plugin = await cmaClient(envName).plugins.find(pluginId);
  return (plugin.parameters ?? {}) as Record<string, unknown>;
};

/** Replace the plugin's parameters in an environment. */
export const setPluginParams = async (
  envName: string,
  parameters: Record<string, unknown>,
): Promise<void> => {
  const pluginId = await resolvePluginId();
  await cmaClient(envName).plugins.update(pluginId, { parameters });
};
