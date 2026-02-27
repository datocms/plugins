import { LambdaBackupStatus } from "../types/types";
import { normalizeBaseUrlForLegacyFallback } from "./verifyLambdaHealth";

const STATUS_TIMEOUT_MS = 10000;
const RESPONSE_SNIPPET_MAX_LENGTH = 280;
const STATUS_EVENT_TYPE = "backup_status_request";
const STATUS_MPI_REQUEST_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_STATUS";
const STATUS_MPI_RESPONSE_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_STATUS";
const STATUS_MPI_VERSION = "2026-02-26";
const EXPECTED_PLUGIN_NAME = "datocms-plugin-automatic-environment-backups";
const EXPECTED_SERVICE_NAME = "datocms-backups-scheduled-function";
const EXPECTED_SERVICE_STATUS = "ready";

export class LambdaBackupStatusError extends Error {
  readonly endpoint: string;
  readonly code:
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
    this.name = "LambdaBackupStatusError";
    this.code = code;
    this.endpoint = endpoint;
    this.httpStatus = httpStatus;
    this.responseSnippet = responseSnippet;
  }
}

type FetchLambdaBackupStatusInput = {
  baseUrl: string;
  environment: string;
};

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const toValidatedStatus = (payload: unknown): LambdaBackupStatus | null => {
  if (!isObject(payload)) {
    return null;
  }

  const scheduler = payload.scheduler;
  const slots = payload.slots;
  if (
    payload.ok !== true ||
    !isObject(payload.mpi) ||
    payload.mpi.message !== STATUS_MPI_RESPONSE_MESSAGE ||
    payload.mpi.version !== STATUS_MPI_VERSION ||
    payload.service !== EXPECTED_SERVICE_NAME ||
    payload.status !== EXPECTED_SERVICE_STATUS ||
    !isObject(scheduler) ||
    !isObject(slots) ||
    typeof payload.checkedAt !== "string"
  ) {
    return null;
  }

  if (
    (scheduler.provider !== "vercel" &&
      scheduler.provider !== "netlify" &&
      scheduler.provider !== "cloudflare" &&
      scheduler.provider !== "unknown") ||
    (scheduler.cadence !== "hourly" && scheduler.cadence !== "daily")
  ) {
    return null;
  }

  const daily = slots.daily;
  const weekly = slots.weekly;
  if (!isObject(daily) || !isObject(weekly)) {
    return null;
  }

  if (
    daily.scope !== "daily" ||
    daily.executionMode !== "lambda_cron" ||
    !isIsoOrNull(daily.lastBackupAt) ||
    !isIsoOrNull(daily.nextBackupAt) ||
    weekly.scope !== "weekly" ||
    weekly.executionMode !== "lambda_cron" ||
    !isIsoOrNull(weekly.lastBackupAt) ||
    !isIsoOrNull(weekly.nextBackupAt)
  ) {
    return null;
  }

  return {
    scheduler: {
      provider: scheduler.provider,
      cadence: scheduler.cadence,
    },
    slots: {
      daily: {
        scope: "daily",
        executionMode: "lambda_cron",
        lastBackupAt: daily.lastBackupAt,
        nextBackupAt: daily.nextBackupAt,
      },
      weekly: {
        scope: "weekly",
        executionMode: "lambda_cron",
        lastBackupAt: weekly.lastBackupAt,
        nextBackupAt: weekly.nextBackupAt,
      },
    },
    checkedAt: payload.checkedAt,
  };
};

export const fetchLambdaBackupStatus = async ({
  baseUrl,
  environment,
}: FetchLambdaBackupStatusInput): Promise<LambdaBackupStatus> => {
  const normalizedBaseUrl = normalizeBaseUrlForLegacyFallback(baseUrl);
  const endpoint = new URL("/api/datocms/backup-status", `${normalizedBaseUrl}/`).toString();
  const body = JSON.stringify({
    event_type: STATUS_EVENT_TYPE,
    mpi: {
      message: STATUS_MPI_REQUEST_MESSAGE,
      version: STATUS_MPI_VERSION,
    },
    plugin: {
      name: EXPECTED_PLUGIN_NAME,
      environment,
    },
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "*/*", "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new LambdaBackupStatusError({
        code: "TIMEOUT",
        endpoint,
        message: `Backup status request timed out after ${STATUS_TIMEOUT_MS}ms.`,
      });
    }

    throw new LambdaBackupStatusError({
      code: "NETWORK",
      endpoint,
      message: "Could not reach backup status endpoint.",
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const payloadText = await response.text();
  const responseSnippet = truncateSnippet(payloadText);

  if (!response.ok) {
    throw new LambdaBackupStatusError({
      code: "HTTP",
      endpoint,
      httpStatus: response.status,
      responseSnippet,
      message: `Backup status endpoint returned HTTP ${response.status}.`,
    });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = payloadText.trim() ? JSON.parse(payloadText) : null;
  } catch {
    throw new LambdaBackupStatusError({
      code: "INVALID_JSON",
      endpoint,
      responseSnippet,
      message: "Backup status endpoint returned invalid JSON.",
    });
  }

  const status = toValidatedStatus(parsedPayload);
  if (!status) {
    throw new LambdaBackupStatusError({
      code: "INVALID_RESPONSE",
      endpoint,
      responseSnippet,
      message: "Backup status response did not match the expected contract.",
    });
  }

  return status;
};
