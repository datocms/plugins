import {
  buildLambdaHttpErrorMessage,
  buildLambdaJsonHeaders,
  LambdaAuthSecretError,
} from "./lambdaAuth";
import {
  createTimeoutController,
  isAbortError,
  truncateResponseSnippet,
} from "./lambdaHttp";
import { normalizeLambdaBaseUrl } from "./verifyLambdaHealth";
import type { BackupCadence } from "../types/types";

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
  lambdaAuthSecret: string;
  scope?: BackupCadence;
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

const buildScopePayload = (
  scope: BackupCadence | undefined,
): Record<string, unknown> => {
  if (!scope) {
    return {};
  }

  return {
    scope,
  };
};

const buildAttempts = (
  environment: string,
  scope: BackupCadence | undefined,
): TriggerAttempt[] => {
  const scopePayload = buildScopePayload(scope);
  const pluginPayload = {
    plugin: {
      name: PLUGIN_NAME,
      environment,
    },
    ...scopePayload,
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
  ];
};

export const triggerBackupNow = async ({
  baseUrl,
  environment,
  lambdaAuthSecret,
  scope,
}: TriggerBackupNowInput): Promise<TriggerBackupNowResult> => {
  const normalizedBaseUrl = normalizeLambdaBaseUrl(baseUrl);
  const attempts = buildAttempts(environment, scope);
  const failures: TriggerBackupNowFailure[] = [];
  let requestHeaders: Record<string, string>;

  try {
    requestHeaders = buildLambdaJsonHeaders(lambdaAuthSecret);
  } catch (error) {
    if (error instanceof LambdaAuthSecretError) {
      throw new TriggerBackupNowError(error.message, normalizedBaseUrl, [
        {
          name: "/api/datocms/backup-now",
          endpoint: new URL("/api/datocms/backup-now", `${normalizedBaseUrl}/`).toString(),
          method: "POST",
          errorMessage: error.message,
        },
      ]);
    }
    throw error;
  }

  for (const attempt of attempts) {
    const endpoint = new URL(attempt.path, `${normalizedBaseUrl}/`).toString();
    const requestBody = attempt.buildBody ? JSON.stringify(attempt.buildBody()) : undefined;
    const timeoutController = createTimeoutController(TRIGGER_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: attempt.method,
        headers: requestHeaders,
        body: requestBody,
        signal: timeoutController.controller.signal,
      });

      const responsePayload = await response.text();
      const responseSnippet = truncateResponseSnippet(
        responsePayload,
        RESPONSE_SNIPPET_MAX_LENGTH,
      );

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
        errorMessage: buildLambdaHttpErrorMessage(
          response.status,
          responsePayload,
          "endpoint returned a non-success status",
        ),
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
      timeoutController.clear();
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
