import type { BackupCadence } from "../types/types";
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

const BACKUP_NOW_TIMEOUT_MS = 60000;
const RESPONSE_SNIPPET_MAX_LENGTH = 280;
const BACKUP_NOW_EVENT_TYPE = "backup_now_request";
const BACKUP_NOW_MPI_REQUEST_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_BACKUP_NOW";
const BACKUP_NOW_MPI_RESPONSE_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_BACKUP_NOW";
const BACKUP_NOW_MPI_VERSION = "2026-02-26";
const EXPECTED_PLUGIN_NAME = "datocms-plugin-automatic-environment-backups";
const EXPECTED_SERVICE_NAME = "datocms-backups-scheduled-function";
const EXPECTED_SERVICE_STATUS = "ready";

export type LambdaBackupNowResult = {
  scope: BackupCadence;
  executionMode: "lambda_cron";
  createdEnvironmentId: string;
  deletedEnvironmentId: string | null;
  completedAt: string;
  checkedAt: string;
};

export class LambdaBackupNowError extends Error {
  readonly endpoint: string;
  readonly code:
    | "MISSING_AUTH_SECRET"
    | "TIMEOUT"
    | "NETWORK"
    | "HTTP"
    | "INVALID_JSON"
    | "INVALID_RESPONSE";
  readonly httpStatus?: number;
  readonly responseSnippet?: string;

  constructor({
    code,
    endpoint,
    message,
    httpStatus,
    responseSnippet,
  }: {
    code:
      | "MISSING_AUTH_SECRET"
      | "TIMEOUT"
      | "NETWORK"
      | "HTTP"
      | "INVALID_JSON"
      | "INVALID_RESPONSE";
    endpoint: string;
    message: string;
    httpStatus?: number;
    responseSnippet?: string;
  }) {
    super(message);
    this.name = "LambdaBackupNowError";
    this.code = code;
    this.endpoint = endpoint;
    this.httpStatus = httpStatus;
    this.responseSnippet = responseSnippet;
  }
}

type TriggerLambdaBackupNowInput = {
  baseUrl: string;
  environment: string;
  scope: BackupCadence;
  lambdaAuthSecret: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOptionalStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const toValidatedBackupNowResult = (
  payload: unknown,
  expectedScope: BackupCadence,
): LambdaBackupNowResult | null => {
  if (!isObject(payload)) {
    return null;
  }

  const mpi = payload.mpi;
  const backup = payload.backup;

  if (
    payload.ok !== true ||
    !isObject(mpi) ||
    mpi.message !== BACKUP_NOW_MPI_RESPONSE_MESSAGE ||
    mpi.version !== BACKUP_NOW_MPI_VERSION ||
    payload.service !== EXPECTED_SERVICE_NAME ||
    payload.status !== EXPECTED_SERVICE_STATUS ||
    !isObject(backup) ||
    payload.checkedAt === "" ||
    typeof payload.checkedAt !== "string"
  ) {
    return null;
  }

  if (
    backup.scope !== expectedScope ||
    backup.executionMode !== "lambda_cron" ||
    typeof backup.createdEnvironmentId !== "string" ||
    backup.createdEnvironmentId.trim().length === 0 ||
    !isOptionalStringOrNull(backup.deletedEnvironmentId) ||
    typeof backup.completedAt !== "string"
  ) {
    return null;
  }

  return {
    scope: expectedScope,
    executionMode: "lambda_cron",
    createdEnvironmentId: backup.createdEnvironmentId,
    deletedEnvironmentId: backup.deletedEnvironmentId,
    completedAt: backup.completedAt,
    checkedAt: payload.checkedAt,
  };
};

export const triggerLambdaBackupNow = async ({
  baseUrl,
  environment,
  scope,
  lambdaAuthSecret,
}: TriggerLambdaBackupNowInput): Promise<LambdaBackupNowResult> => {
  const normalizedBaseUrl = normalizeLambdaBaseUrl(baseUrl);
  const endpoint = new URL("/api/datocms/backup-now", `${normalizedBaseUrl}/`).toString();
  const body = JSON.stringify({
    event_type: BACKUP_NOW_EVENT_TYPE,
    mpi: {
      message: BACKUP_NOW_MPI_REQUEST_MESSAGE,
      version: BACKUP_NOW_MPI_VERSION,
    },
    plugin: {
      name: EXPECTED_PLUGIN_NAME,
      environment,
    },
    slot: {
      scope,
    },
  });

  const timeoutController = createTimeoutController(BACKUP_NOW_TIMEOUT_MS);
  let response: Response;
  let requestHeaders: Record<string, string>;

  try {
    requestHeaders = buildLambdaJsonHeaders(lambdaAuthSecret);
  } catch (error) {
    if (error instanceof LambdaAuthSecretError) {
      throw new LambdaBackupNowError({
        code: "MISSING_AUTH_SECRET",
        endpoint,
        message: error.message,
      });
    }
    throw error;
  }

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body,
      signal: timeoutController.controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new LambdaBackupNowError({
        code: "TIMEOUT",
        endpoint,
        message: `Backup now request timed out after ${BACKUP_NOW_TIMEOUT_MS}ms.`,
      });
    }

    throw new LambdaBackupNowError({
      code: "NETWORK",
      endpoint,
      message: "Could not reach backup now endpoint.",
    });
  } finally {
    timeoutController.clear();
  }

  const payloadText = await response.text();
  const responseSnippet = truncateResponseSnippet(
    payloadText,
    RESPONSE_SNIPPET_MAX_LENGTH,
  );

  if (!response.ok) {
    throw new LambdaBackupNowError({
      code: "HTTP",
      endpoint,
      httpStatus: response.status,
      responseSnippet,
      message: buildLambdaHttpErrorMessage(
        response.status,
        payloadText,
        "backup now endpoint returned an error status",
      ),
    });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = payloadText.trim() ? JSON.parse(payloadText) : null;
  } catch {
    throw new LambdaBackupNowError({
      code: "INVALID_JSON",
      endpoint,
      responseSnippet,
      message: "Backup now endpoint returned invalid JSON.",
    });
  }

  const result = toValidatedBackupNowResult(parsedPayload, scope);
  if (!result) {
    throw new LambdaBackupNowError({
      code: "INVALID_RESPONSE",
      endpoint,
      responseSnippet,
      message: "Backup now response did not match the expected contract.",
    });
  }

  return result;
};
