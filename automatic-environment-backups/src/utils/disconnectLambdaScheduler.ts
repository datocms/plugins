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

const DISCONNECT_TIMEOUT_MS = 10000;
const RESPONSE_SNIPPET_MAX_LENGTH = 280;
const MAX_FAILURE_DETAILS = 6;
const DISCONNECT_EVENT_TYPE = "scheduler_disconnect_request";
const DISCONNECT_MPI_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_SCHEDULER_DISCONNECT";
const DISCONNECT_MPI_VERSION = "2026-02-26";
const PLUGIN_NAME = "datocms-plugin-automatic-environment-backups";

type DisconnectAttempt = {
  name: string;
  path: string;
};

export type DisconnectLambdaSchedulerInput = {
  baseUrl: string;
  environment: string;
  lambdaAuthSecret: string;
};

export type DisconnectLambdaSchedulerFailure = {
  name: string;
  endpoint: string;
  errorMessage: string;
  httpStatus?: number;
  responseSnippet?: string;
};

export type DisconnectLambdaSchedulerResult = {
  endpoint: string;
  normalizedBaseUrl: string;
  disconnectedAt: string;
  attemptName: string;
  responseSnippet?: string;
};

export class DisconnectLambdaSchedulerError extends Error {
  readonly normalizedBaseUrl: string;
  readonly failures: DisconnectLambdaSchedulerFailure[];

  constructor(
    message: string,
    normalizedBaseUrl: string,
    failures: DisconnectLambdaSchedulerFailure[],
  ) {
    super(message);
    this.name = "DisconnectLambdaSchedulerError";
    this.normalizedBaseUrl = normalizedBaseUrl;
    this.failures = failures;
  }
}

const buildAttempts = (): DisconnectAttempt[] => {
  return [
    {
      name: "/api/datocms/scheduler-disconnect",
      path: "/api/datocms/scheduler-disconnect",
    },
  ];
};

export const disconnectLambdaScheduler = async ({
  baseUrl,
  environment,
  lambdaAuthSecret,
}: DisconnectLambdaSchedulerInput): Promise<DisconnectLambdaSchedulerResult> => {
  const normalizedBaseUrl = normalizeLambdaBaseUrl(baseUrl);
  const attempts = buildAttempts();
  const requestBody = JSON.stringify({
    event_type: DISCONNECT_EVENT_TYPE,
    mpi: {
      message: DISCONNECT_MPI_MESSAGE,
      version: DISCONNECT_MPI_VERSION,
    },
    plugin: {
      name: PLUGIN_NAME,
      environment,
    },
  });
  const failures: DisconnectLambdaSchedulerFailure[] = [];
  let requestHeaders: Record<string, string>;

  try {
    requestHeaders = buildLambdaJsonHeaders(lambdaAuthSecret);
  } catch (error) {
    if (error instanceof LambdaAuthSecretError) {
      throw new DisconnectLambdaSchedulerError(error.message, normalizedBaseUrl, [
        {
          name: "/api/datocms/scheduler-disconnect",
          endpoint: new URL(
            "/api/datocms/scheduler-disconnect",
            `${normalizedBaseUrl}/`,
          ).toString(),
          errorMessage: error.message,
        },
      ]);
    }
    throw error;
  }

  for (const attempt of attempts) {
    const endpoint = new URL(attempt.path, `${normalizedBaseUrl}/`).toString();
    const timeoutController = createTimeoutController(DISCONNECT_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
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
          disconnectedAt: new Date().toISOString(),
          attemptName: attempt.name,
          responseSnippet,
        };
      }

      failures.push({
        name: attempt.name,
        endpoint,
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
        errorMessage: isAbortError(error)
          ? `Request timed out after ${DISCONNECT_TIMEOUT_MS}ms.`
          : "Could not reach this endpoint.",
      });
    } finally {
      timeoutController.clear();
    }
  }

  throw new DisconnectLambdaSchedulerError(
    "Could not disable scheduler using known lambda endpoints.",
    normalizedBaseUrl,
    failures,
  );
};

export const getDisconnectLambdaSchedulerErrorDetails = (
  error: DisconnectLambdaSchedulerError,
): string[] => {
  const shownFailures = error.failures.slice(0, MAX_FAILURE_DETAILS);
  const remainingCount = error.failures.length - shownFailures.length;

  const details = [
    "Could not disable scheduler in this deployment.",
    `Base URL: ${error.normalizedBaseUrl}.`,
  ];

  shownFailures.forEach((failure, index) => {
    details.push(`Attempt ${index + 1}: ${failure.name} -> POST ${failure.endpoint}`);
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
