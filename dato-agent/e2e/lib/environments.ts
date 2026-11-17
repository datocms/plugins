import { buildClient, type Client } from '@datocms/cma-client-browser';

export type ForkedEnvironment = {
  client: Client;
  environment: string;
  destroy(): Promise<void>;
};

/**
 * Forks the seed project's primary environment so a live run starts from the
 * same schema and content every time. Forks inherit the source's opt-in
 * upgrade flags and plugins.
 */
export async function forkSeedEnvironment(
  cmaToken: string,
  label: string,
): Promise<ForkedEnvironment> {
  const admin = buildClient({ apiToken: cmaToken });
  const primary = (await admin.environments.list()).find(
    (environment) => environment.meta.primary,
  );
  if (!primary) throw new Error('The seed project has no primary environment');
  const environment = `e2e-${label}-${Date.now().toString(36)}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-');
  await admin.environments.fork(primary.id, { id: environment });
  return {
    client: buildClient({ apiToken: cmaToken, environment }),
    environment,
    destroy: async () => {
      await admin.environments.destroy(environment);
    },
  };
}
