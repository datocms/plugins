import { buildClient } from "@datocms/cma-client-browser";

export const MANAGED_BACKUP_ENVIRONMENT_IDS = {
  daily: "automatic-backups-daily",
  weekly: "automatic-backups-weekly",
} as const;

export type BackupSlot = keyof typeof MANAGED_BACKUP_ENVIRONMENT_IDS;

export type LambdaLessBackupInput = {
  currentUserAccessToken: string | undefined;
  slot: BackupSlot;
};

export type LambdaLessBackupResult = {
  slot: BackupSlot;
  managedEnvironmentId: string;
  sourceEnvironmentId: string;
  replacedExistingEnvironment: boolean;
  completedAt: string;
};

export const backupEnvironmentSlotWithoutLambda = async ({
  currentUserAccessToken,
  slot,
}: LambdaLessBackupInput): Promise<LambdaLessBackupResult> => {
  if (!currentUserAccessToken) {
    throw new Error("Missing currentUserAccessToken for Lambda-less backups.");
  }

  const client = buildClient({
    apiToken: currentUserAccessToken,
  });

  const environments = await client.environments.list();
  const primaryEnvironment = environments.find((environment) => environment.meta.primary);

  if (!primaryEnvironment) {
    throw new Error("Could not find the primary environment to create a backup from.");
  }

  const managedEnvironmentId = MANAGED_BACKUP_ENVIRONMENT_IDS[slot];

  if (managedEnvironmentId === primaryEnvironment.id) {
    throw new Error(
      `Refusing to overwrite the primary environment "${primaryEnvironment.id}".`,
    );
  }

  const existingManagedEnvironment = environments.find(
    (environment) => environment.id === managedEnvironmentId,
  );

  if (existingManagedEnvironment?.meta.primary) {
    throw new Error(
      `Refusing to destroy managed environment "${managedEnvironmentId}" because it is marked as primary.`,
    );
  }

  if (existingManagedEnvironment) {
    await client.environments.destroy(existingManagedEnvironment.id);
  }

  await client.environments.fork(
    primaryEnvironment.id,
    { id: managedEnvironmentId },
    { immediate_return: false },
  );

  return {
    slot,
    managedEnvironmentId,
    sourceEnvironmentId: primaryEnvironment.id,
    replacedExistingEnvironment: Boolean(existingManagedEnvironment),
    completedAt: new Date().toISOString(),
  };
};
