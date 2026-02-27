import { LambdaBackupStatus } from "../types/types";
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
  lambdaAuthSecret: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const toValidatedSlot = (
  candidate: unknown,
  expectedScope: "daily" | "weekly" | "biweekly" | "monthly",
): LambdaBackupStatus["slots"]["daily"] | null => {
  if (!isObject(candidate)) {
    return null;
  }

  if (
    candidate.scope !== expectedScope ||
    candidate.executionMode !== "lambda_cron" ||
    !isIsoOrNull(candidate.lastBackupAt) ||
    !isIsoOrNull(candidate.nextBackupAt)
  ) {
    return null;
  }

  return {
    scope: expectedScope,
    executionMode: "lambda_cron",
    lastBackupAt: candidate.lastBackupAt,
    nextBackupAt: candidate.nextBackupAt,
  };
};

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

  const dailySlot = toValidatedSlot(slots.daily, "daily");
  const weeklySlot = toValidatedSlot(slots.weekly, "weekly");
  if (!dailySlot || !weeklySlot) {
    return null;
  }

  const biweeklySlot = toValidatedSlot(slots.biweekly, "biweekly");
  const monthlySlot = toValidatedSlot(slots.monthly, "monthly");
  const validatedSlots: LambdaBackupStatus["slots"] = {
    daily: dailySlot,
    weekly: weeklySlot,
  };

  if (biweeklySlot) {
    validatedSlots.biweekly = biweeklySlot;
  }
  if (monthlySlot) {
    validatedSlots.monthly = monthlySlot;
  }

  return {
    scheduler: {
      provider: scheduler.provider,
      cadence: scheduler.cadence,
    },
    slots: validatedSlots,
    checkedAt: payload.checkedAt,
  };
};

export const fetchLambdaBackupStatus = async ({
  baseUrl,
  environment,
  lambdaAuthSecret,
}: FetchLambdaBackupStatusInput): Promise<LambdaBackupStatus> => {
  const normalizedBaseUrl = normalizeLambdaBaseUrl(baseUrl);
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

  const timeoutController = createTimeoutController(STATUS_TIMEOUT_MS);
  let response: Response;
  let requestHeaders: Record<string, string>;

  try {
    requestHeaders = buildLambdaJsonHeaders(lambdaAuthSecret);
  } catch (error) {
    if (error instanceof LambdaAuthSecretError) {
      throw new LambdaBackupStatusError({
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
    timeoutController.clear();
  }

  const payloadText = await response.text();
  const responseSnippet = truncateResponseSnippet(
    payloadText,
    RESPONSE_SNIPPET_MAX_LENGTH,
  );

  if (!response.ok) {
    throw new LambdaBackupStatusError({
      code: "HTTP",
      endpoint,
      httpStatus: response.status,
      responseSnippet,
      message: buildLambdaHttpErrorMessage(
        response.status,
        payloadText,
        "backup status endpoint returned an error status",
      ),
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
