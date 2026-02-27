import { OnBootCtx } from "datocms-plugin-sdk";
import { AutomaticBackupsScheduleState } from "../types/types";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";
import { getRuntimeMode } from "./getRuntimeMode";
import { backupEnvironmentSlotWithoutLambda } from "./lambdaLessBackup";

type PluginParameters = Record<string, unknown> | undefined;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const getAutomaticBackupsScheduleState = (
  parameters: PluginParameters,
): AutomaticBackupsScheduleState => {
  const candidate = parameters?.automaticBackupsSchedule;
  if (!isObject(candidate)) {
    return {};
  }

  return {
    dailyLastRunDate: asOptionalString(candidate.dailyLastRunDate),
    weeklyLastRunKey: asOptionalString(candidate.weeklyLastRunKey),
    lastDailyRunAt: asOptionalString(candidate.lastDailyRunAt),
    lastWeeklyRunAt: asOptionalString(candidate.lastWeeklyRunAt),
    lastDailyManagedEnvironmentId: asOptionalString(
      candidate.lastDailyManagedEnvironmentId,
    ),
    lastWeeklyManagedEnvironmentId: asOptionalString(
      candidate.lastWeeklyManagedEnvironmentId,
    ),
    lastDailyExecutionMode:
      candidate.lastDailyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastWeeklyExecutionMode:
      candidate.lastWeeklyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastDailyError: asOptionalString(candidate.lastDailyError),
    lastWeeklyError: asOptionalString(candidate.lastWeeklyError),
  };
};

export const toUtcDateKey = (date: Date): string =>
  date.toISOString().split("T")[0];

export const toUtcIsoWeekKey = (date: Date): string => {
  const workingDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((workingDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${workingDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const backupOnBoot = async (ctx: OnBootCtx) => {
  const pluginParameters = ctx.plugin.attributes.parameters as PluginParameters;
  const debugLogger = createDebugLogger(
    isDebugEnabled(pluginParameters),
    "backupOnBoot",
  );
  const runtimeMode = getRuntimeMode(pluginParameters);

  debugLogger.log("Evaluating on-boot backup execution", { runtimeMode });

  if (runtimeMode === "lambda") {
    debugLogger.log("Skipping on-boot backup because cron mode is enabled");
    return;
  }

  const now = new Date();
  const currentDateKey = toUtcDateKey(now);
  const currentWeekKey = toUtcIsoWeekKey(now);
  const existingScheduleState = getAutomaticBackupsScheduleState(pluginParameters);
  const nextScheduleState: AutomaticBackupsScheduleState = {
    ...existingScheduleState,
  };

  const shouldRunDaily = existingScheduleState.dailyLastRunDate !== currentDateKey;
  const shouldRunWeekly = existingScheduleState.weeklyLastRunKey !== currentWeekKey;
  let shouldPersistScheduleState = false;

  debugLogger.log("Computed lambdaless backup schedule", {
    currentDateKey,
    currentWeekKey,
    shouldRunDaily,
    shouldRunWeekly,
  });

  if (!shouldRunDaily && !shouldRunWeekly) {
    debugLogger.log("Skipping on-boot backup because schedule is up to date");
    return;
  }

  if (shouldRunDaily) {
    try {
      const result = await backupEnvironmentSlotWithoutLambda({
        currentUserAccessToken: ctx.currentUserAccessToken,
        slot: "daily",
      });
      debugLogger.log("Daily lambdaless backup completed", result);
      nextScheduleState.dailyLastRunDate = currentDateKey;
      nextScheduleState.lastDailyRunAt = result.completedAt;
      nextScheduleState.lastDailyManagedEnvironmentId = result.managedEnvironmentId;
      nextScheduleState.lastDailyExecutionMode = "lambdaless_on_boot";
      delete nextScheduleState.lastDailyError;
      shouldPersistScheduleState = true;
    } catch (error) {
      debugLogger.error("Daily lambdaless backup failed", error);
      nextScheduleState.lastDailyError = getErrorMessage(error);
      shouldPersistScheduleState = true;
    }
  }

  if (shouldRunWeekly) {
    try {
      const result = await backupEnvironmentSlotWithoutLambda({
        currentUserAccessToken: ctx.currentUserAccessToken,
        slot: "weekly",
      });
      debugLogger.log("Weekly lambdaless backup completed", result);
      nextScheduleState.weeklyLastRunKey = currentWeekKey;
      nextScheduleState.lastWeeklyRunAt = result.completedAt;
      nextScheduleState.lastWeeklyManagedEnvironmentId = result.managedEnvironmentId;
      nextScheduleState.lastWeeklyExecutionMode = "lambdaless_on_boot";
      delete nextScheduleState.lastWeeklyError;
      shouldPersistScheduleState = true;
    } catch (error) {
      debugLogger.error("Weekly lambdaless backup failed", error);
      nextScheduleState.lastWeeklyError = getErrorMessage(error);
      shouldPersistScheduleState = true;
    }
  }

  if (!shouldPersistScheduleState) {
    return;
  }

  await ctx.updatePluginParameters({
    ...(pluginParameters ?? {}),
    automaticBackupsSchedule: nextScheduleState,
  });
  debugLogger.log("Persisted on-boot backup schedule state", {
    automaticBackupsSchedule: nextScheduleState,
  });
};

export default backupOnBoot;
