import { normalizeBaseUrlForLegacyFallback } from "./verifyLambdaHealth";

const TRIGGER_TIMEOUT_MS = 10000;
const RESPONSE_SNIPPET_MAX_LENGTH = 280;
const MAX_FAILURE_DETAILS = 6;
const TRIGGER_MPI_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_TRIGGER";
const TRIGGER_MPI_VERSION = "2026-02-26";
const PLUGIN_NAME = "datocms-plugin-automatic-environment-backups";

type TriggerMethod = "GET" | "POST";

type TriggerAttempt = {
  name: string;
  path: string;
  method: TriggerMethod;
  buildBody?: () => Record<string, unknown>;
};

export type TriggerBackupNowInput = {
  baseUrl: string;
  environment: string;
};

export type TriggerBackupNowFailure = {
  name: string;
  endpoint: string;
  method: TriggerMethod;
  errorMessage: string;
  httpStatus?: number;
  responseSnippet?: string;
};

export type TriggerBackupNowResult = {
  endpoint: string;
  normalizedBaseUrl: string;
  triggeredAt: string;
  attemptName: string;
  method: TriggerMethod;
  responseSnippet?: string;
};

export class TriggerBackupNowError extends Error {
  readonly normalizedBaseUrl: string;
  readonly failures: TriggerBackupNowFailure[];

  constructor(
    message: string,
    normalizedBaseUrl: string,
    failures: TriggerBackupNowFailure[],
  ) {
    super(message);
    this.name = "TriggerBackupNowError";
    this.normalizedBaseUrl = normalizedBaseUrl;
    this.failures = failures;
  }
}

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: string }).name === "AbortError";

const truncateSnippet = (value: string): string => {
  if (!value) {
    return "";
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= RESPONSE_SNIPPET_MAX_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, RESPONSE_SNIPPET_MAX_LENGTH)}...`;
};

const buildAttempts = (environment: string): TriggerAttempt[] => {
  const pluginPayload = {
    plugin: {
      name: PLUGIN_NAME,
      environment,
    },
  };

  return [
    {
      name: "/api/datocms/backup-now (backup_now)",
      path: "/api/datocms/backup-now",
      method: "POST",
      buildBody: () => ({
        event_type: "backup_now",
        mpi: {
          message: TRIGGER_MPI_MESSAGE,
          version: TRIGGER_MPI_VERSION,
          source: "config_screen",
        },
        ...pluginPayload,
      }),
    },
    {
      name: "/api/datocms/backup-now (manual_backup)",
      path: "/api/datocms/backup-now",
      method: "POST",
      buildBody: () => ({
        event_type: "manual_backup",
        ...pluginPayload,
      }),
    },
    {
      name: "/ (backup_now)",
      path: "/",
      method: "POST",
      buildBody: () => ({
        event_type: "backup_now",
        environment,
      }),
    },
    {
      name: "/ (manual_backup)",
      path: "/",
      method: "POST",
      buildBody: () => ({
        event_type: "manual_backup",
        environment,
      }),
    },
    {
      name: "/ (initialization)",
      path: "/",
      method: "POST",
      buildBody: () => ({
        event_type: "initialization",
        environment,
      }),
    },
    {
      name: "/.netlify/functions/dailyBackup",
      path: "/.netlify/functions/dailyBackup",
      method: "GET",
    },
    {
      name: "/.netlify/functions/weeklyBackup",
      path: "/.netlify/functions/weeklyBackup",
      method: "GET",
    },
    {
      name: "/.netlify/functions/initialization",
      path: "/.netlify/functions/initialization",
      method: "GET",
    },
  ];
};

export const triggerBackupNow = async ({
  baseUrl,
  environment,
}: TriggerBackupNowInput): Promise<TriggerBackupNowResult> => {
  const normalizedBaseUrl = normalizeBaseUrlForLegacyFallback(baseUrl);
  const attempts = buildAttempts(environment);
  const failures: TriggerBackupNowFailure[] = [];

  for (const attempt of attempts) {
    const endpoint = new URL(attempt.path, `${normalizedBaseUrl}/`).toString();
    const requestBody = attempt.buildBody ? JSON.stringify(attempt.buildBody()) : undefined;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: attempt.method,
        headers: requestBody
          ? { Accept: "*/*", "Content-Type": "application/json" }
          : { Accept: "*/*" },
        body: requestBody,
        signal: controller.signal,
      });

      const responsePayload = await response.text();
      const responseSnippet = truncateSnippet(responsePayload);

      if (response.ok) {
        return {
          endpoint,
          normalizedBaseUrl,
          triggeredAt: new Date().toISOString(),
          attemptName: attempt.name,
          method: attempt.method,
          responseSnippet,
        };
      }

      failures.push({
        name: attempt.name,
        endpoint,
        method: attempt.method,
        errorMessage: `HTTP ${response.status}: endpoint returned a non-success status.`,
        httpStatus: response.status,
        responseSnippet,
      });
    } catch (error) {
      failures.push({
        name: attempt.name,
        endpoint,
        method: attempt.method,
        errorMessage: isAbortError(error)
          ? `Request timed out after ${TRIGGER_TIMEOUT_MS}ms.`
          : "Could not reach this endpoint.",
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new TriggerBackupNowError(
    "Could not trigger an on-demand backup using known lambda endpoints.",
    normalizedBaseUrl,
    failures,
  );
};

export const getTriggerBackupNowErrorDetails = (
  error: TriggerBackupNowError,
): string[] => {
  const shownFailures = error.failures.slice(0, MAX_FAILURE_DETAILS);
  const remainingCount = error.failures.length - shownFailures.length;

  const details = [
    "Could not trigger an on-demand backup from this deployment.",
    `Base URL: ${error.normalizedBaseUrl}.`,
  ];

  shownFailures.forEach((failure, index) => {
    details.push(
      `Attempt ${index + 1}: ${failure.name} -> ${failure.method} ${failure.endpoint}`,
    );
    details.push(`Result: ${failure.errorMessage}`);
    if (failure.responseSnippet) {
      details.push(`Response snippet: ${failure.responseSnippet}`);
    }
  });

  if (remainingCount > 0) {
    details.push(`...and ${remainingCount} more attempt(s).`);
  }

  return details;
};
