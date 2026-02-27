import { buildClient } from "@datocms/cma-client-browser";

export const MANAGED_BACKUP_ENVIRONMENT_IDS = {
  daily: "automatic-backups-daily",
  weekly: "automatic-backups-weekly",
  biweekly: "automatic-backups-biweekly",
  monthly: "automatic-backups-monthly",
} as const;

export type BackupSlot = keyof typeof MANAGED_BACKUP_ENVIRONMENT_IDS;
const MANAGED_BACKUP_ENVIRONMENT_ID_SET = new Set<string>(
  Object.values(MANAGED_BACKUP_ENVIRONMENT_IDS),
);

type LambdaLessEnvironment = {
  id: string;
  meta?: {
    primary?: boolean;
    status?: string;
  };
};

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

export type ManagedBackupForkStatusInput = {
  currentUserAccessToken: string | undefined;
};

export type ManagedBackupForkStatusResult = {
  hasInProgressManagedFork: boolean;
  inProgressManagedEnvironmentIds: string[];
};

const buildLambdaLessClient = (currentUserAccessToken: string | undefined) => {
  if (!currentUserAccessToken) {
    throw new Error("Missing currentUserAccessToken for Lambda-less backups.");
  }

  return buildClient({
    apiToken: currentUserAccessToken,
  });
};

const listLambdaLessEnvironments = async (currentUserAccessToken: string | undefined) => {
  const client = buildLambdaLessClient(currentUserAccessToken);
  const environments = (await client.environments.list()) as LambdaLessEnvironment[];
  return { client, environments };
};

const isEnvironmentForkInProgress = (status: unknown): boolean =>
  status === "creating" || status === "destroying";

export const getManagedBackupForkStatusWithoutLambda = async ({
  currentUserAccessToken,
}: ManagedBackupForkStatusInput): Promise<ManagedBackupForkStatusResult> => {
  const { environments } = await listLambdaLessEnvironments(currentUserAccessToken);
  const inProgressManagedEnvironmentIds = environments
    .filter(
      (environment) =>
        MANAGED_BACKUP_ENVIRONMENT_ID_SET.has(environment.id) &&
        isEnvironmentForkInProgress(environment.meta?.status),
    )
    .map((environment) => environment.id);

  return {
    hasInProgressManagedFork: inProgressManagedEnvironmentIds.length > 0,
    inProgressManagedEnvironmentIds,
  };
};

export const backupEnvironmentSlotWithoutLambda = async ({
  currentUserAccessToken,
  slot,
}: LambdaLessBackupInput): Promise<LambdaLessBackupResult> => {
  const { client, environments } = await listLambdaLessEnvironments(
    currentUserAccessToken,
  );
  const primaryEnvironment = environments.find((environment) => environment.meta?.primary);

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

  if (existingManagedEnvironment?.meta?.primary) {
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
