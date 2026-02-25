import {
  LambdaConnectionErrorCode,
  LambdaConnectionPhase,
  LambdaConnectionState,
} from "../types/types";
import { createDebugLogger } from "./debugLogger";

const HEALTH_CHECK_TIMEOUT_MS = 8000;
export const HEALTH_ENDPOINT_PATH = "/api/datocms/plugin-health";
const EXPECTED_PLUGIN_NAME = "datocms-plugin-record-bin";
const EXPECTED_MPI_MESSAGE = "DATOCMS_RECORD_BIN_PLUGIN_PING";
const EXPECTED_MPI_VERSION = "2026-02-25";
const EXPECTED_PONG_MESSAGE = "DATOCMS_RECORD_BIN_LAMBDA_PONG";
const EXPECTED_SERVICE_NAME = "record-bin-lambda-function";
const EXPECTED_STATUS = "ready";
const SNIPPET_MAX_LENGTH = 280;
const PROTOCOL_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

type LambdaHealthResponsePayload = {
  ok?: boolean;
  mpi?: {
    message?: string;
    version?: string;
  };
  service?: string;
  status?: string;
};

type LambdaHealthErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
};

type LambdaHealthCheckErrorConstructorProps = {
  code: LambdaConnectionErrorCode;
  message: string;
  phase: LambdaConnectionPhase;
  endpoint: string;
  httpStatus?: number;
  responseSnippet?: string;
};

export type VerifyLambdaHealthInput = {
  baseUrl: string;
  environment: string;
  phase: LambdaConnectionPhase;
  debug?: boolean;
};

export type VerifyLambdaHealthResult = {
  endpoint: string;
  checkedAt: string;
  normalizedBaseUrl: string;
};

export class LambdaHealthCheckError extends Error {
  readonly code: LambdaConnectionErrorCode;
  readonly phase: LambdaConnectionPhase;
  readonly endpoint: string;
  readonly httpStatus?: number;
  readonly responseSnippet?: string;

  constructor({
    code,
    message,
    phase,
    endpoint,
    httpStatus,
    responseSnippet,
  }: LambdaHealthCheckErrorConstructorProps) {
    super(message);
    this.name = "LambdaHealthCheckError";
    this.code = code;
    this.phase = phase;
    this.endpoint = endpoint;
    this.httpStatus = httpStatus;
    this.responseSnippet = responseSnippet;
  }
}

const getFallbackEndpoint = (baseUrl: string): string => {
  const candidate = normalizeCandidateUrl(baseUrl);

  try {
    const parsed = new URL(candidate);
    return new URL(HEALTH_ENDPOINT_PATH, `${parsed.origin}/`).toString();
  } catch {
    return `${candidate || "(empty url)"}${HEALTH_ENDPOINT_PATH}`;
  }
};

const normalizeCandidateUrl = (baseUrl: string): string => {
  const trimmedBaseUrl = baseUrl.trim();

  if (!trimmedBaseUrl) {
    return "";
  }

  if (PROTOCOL_PREFIX_PATTERN.test(trimmedBaseUrl)) {
    return trimmedBaseUrl;
  }

  return `https://${trimmedBaseUrl}`;
};

const normalizeBaseUrl = (
  baseUrl: string,
  phase: LambdaConnectionPhase
): string => {
  const candidate = normalizeCandidateUrl(baseUrl);

  if (!candidate) {
    throw new LambdaHealthCheckError({
      code: "INVALID_URL",
      message: "No URL was provided for the lambda deployment.",
      phase,
      endpoint: "(missing endpoint)",
    });
  }

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new LambdaHealthCheckError({
      code: "INVALID_URL",
      message:
        "The deployed URL is not valid. Use a full URL like https://record-bin.example.com, or paste only the hostname and https will be added automatically.",
      phase,
      endpoint: getFallbackEndpoint(candidate),
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new LambdaHealthCheckError({
      code: "INVALID_URL",
      message:
        "The deployed URL must use http or https. Example: https://record-bin.example.com",
      phase,
      endpoint: getFallbackEndpoint(candidate),
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost";
  const hasDomainDot = hostname.includes(".");
  if (!isLocalhost && !hasDomainDot) {
    throw new LambdaHealthCheckError({
      code: "INVALID_URL",
      message:
        "The deployed URL hostname looks incomplete. Use a full domain like https://record-bin.example.com, or localhost for local testing.",
      phase,
      endpoint: getFallbackEndpoint(candidate),
    });
  }

  return parsed.origin;
};

const truncateSnippet = (value: string): string => {
  if (!value) {
    return "";
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= SNIPPET_MAX_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, SNIPPET_MAX_LENGTH)}...`;
};

const parseJsonPayload = (payload: string): unknown => {
  if (!payload.trim()) {
    throw new Error("empty");
  }

  return JSON.parse(payload);
};

const extractHttpErrorMessage = (payload: string, status: number): string => {
  try {
    const parsedPayload = parseJsonPayload(payload) as LambdaHealthErrorPayload;
    const errorCode = parsedPayload.error?.code;
    const errorMessage =
      parsedPayload.error?.message || parsedPayload.message || "";

    if (errorCode && errorMessage) {
      return `HTTP ${status}: ${errorCode} - ${errorMessage}`;
    }

    if (errorMessage) {
      return `HTTP ${status}: ${errorMessage}`;
    }
  } catch {}

  return `HTTP ${status}: lambda health endpoint returned an error status.`;
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: string }).name === "AbortError";

const isExpectedResponse = (payload: LambdaHealthResponsePayload): boolean => {
  return (
    payload.ok === true &&
    payload.mpi?.message === EXPECTED_PONG_MESSAGE &&
    payload.mpi?.version === EXPECTED_MPI_VERSION &&
    payload.service === EXPECTED_SERVICE_NAME &&
    payload.status === EXPECTED_STATUS
  );
};

const assertExpectedResponse = (
  payload: LambdaHealthResponsePayload,
  endpoint: string,
  phase: LambdaConnectionPhase,
  rawPayload: string
) => {
  if (!isExpectedResponse(payload)) {
    throw new LambdaHealthCheckError({
      code: "UNEXPECTED_RESPONSE",
      message:
        "Health endpoint response did not match the expected MPI PONG contract.",
      phase,
      endpoint,
      responseSnippet: truncateSnippet(rawPayload),
    });
  }
};

const buildUnexpectedResponseMessage = (): string =>
  `Expected HTTP 200 JSON with ok=true, mpi.message=${EXPECTED_PONG_MESSAGE}, mpi.version=${EXPECTED_MPI_VERSION}, service=${EXPECTED_SERVICE_NAME}, status=${EXPECTED_STATUS}.`;

export const verifyLambdaHealth = async ({
  baseUrl,
  environment,
  phase,
  debug = false,
}: VerifyLambdaHealthInput): Promise<VerifyLambdaHealthResult> => {
  const debugLogger = createDebugLogger(debug, "verifyLambdaHealth");
  debugLogger.log("Starting health check", { baseUrl, environment, phase });

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, phase);
  debugLogger.log("Normalized base URL", { normalizedBaseUrl });
  const endpoint = new URL(HEALTH_ENDPOINT_PATH, `${normalizedBaseUrl}/`).toString();
  const checkedAt = new Date().toISOString();
  const requestBody = JSON.stringify({
    event_type: "plugin_health_ping",
    mpi: {
      message: EXPECTED_MPI_MESSAGE,
      version: EXPECTED_MPI_VERSION,
      phase,
    },
    plugin: {
      name: EXPECTED_PLUGIN_NAME,
      environment,
    },
  });
  debugLogger.log("Prepared health check request", {
    endpoint,
    requestBody: JSON.parse(requestBody),
    checkedAt,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: requestBody,
      headers: { Accept: "*/*", "Content-Type": "application/json" },
      signal: controller.signal,
    });
    debugLogger.log("Health check response received", {
      status: response.status,
      ok: response.ok,
    });
  } catch (error) {
    if (isAbortError(error)) {
      debugLogger.warn("Health check request timed out", {
        timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      });
      throw new LambdaHealthCheckError({
        code: "TIMEOUT",
        message: `Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms.`,
        phase,
        endpoint,
      });
    }

    debugLogger.error("Health check request failed due to network error", error);
    throw new LambdaHealthCheckError({
      code: "NETWORK",
      message: "Could not reach the lambda health endpoint.",
      phase,
      endpoint,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const responsePayload = await response.text();
  debugLogger.log("Health check raw payload", {
    payload: truncateSnippet(responsePayload),
  });

  if (!response.ok) {
    debugLogger.warn("Health check returned non-200 status", {
      status: response.status,
    });
    throw new LambdaHealthCheckError({
      code: "HTTP",
      message: extractHttpErrorMessage(responsePayload, response.status),
      phase,
      endpoint,
      httpStatus: response.status,
      responseSnippet: truncateSnippet(responsePayload),
    });
  }

  let parsedResponse: LambdaHealthResponsePayload;

  try {
    parsedResponse = parseJsonPayload(responsePayload) as LambdaHealthResponsePayload;
    debugLogger.log("Health check payload parsed as JSON", parsedResponse);
  } catch {
    debugLogger.warn("Health check payload is not valid JSON");
    throw new LambdaHealthCheckError({
      code: "INVALID_JSON",
      message: "Health endpoint returned HTTP 200 with an invalid JSON payload.",
      phase,
      endpoint,
      responseSnippet: truncateSnippet(responsePayload),
    });
  }

  assertExpectedResponse(parsedResponse, endpoint, phase, responsePayload);
  debugLogger.log("Health check response matched expected contract");

  const result = {
    endpoint,
    checkedAt,
    normalizedBaseUrl,
  };
  debugLogger.log("Health check completed successfully", result);

  return result;
};

export const buildDisconnectedLambdaConnectionState = (
  error: unknown,
  baseUrl: string,
  phase: LambdaConnectionPhase
): LambdaConnectionState => {
  const fallbackEndpoint = getFallbackEndpoint(baseUrl);
  const checkedAt = new Date().toISOString();

  if (error instanceof LambdaHealthCheckError) {
    return {
      status: "disconnected",
      endpoint: error.endpoint || fallbackEndpoint,
      lastCheckedAt: checkedAt,
      lastCheckPhase: phase,
      errorCode: error.code,
      errorMessage: error.message,
      httpStatus: error.httpStatus,
      responseSnippet: error.responseSnippet,
    };
  }

  return {
    status: "disconnected",
    endpoint: fallbackEndpoint,
    lastCheckedAt: checkedAt,
    lastCheckPhase: phase,
    errorCode: "NETWORK",
    errorMessage: "Unexpected error while checking lambda health.",
  };
};

export const buildConnectedLambdaConnectionState = (
  endpoint: string,
  checkedAt: string,
  phase: LambdaConnectionPhase
): LambdaConnectionState => ({
  status: "connected",
  endpoint,
  lastCheckedAt: checkedAt,
  lastCheckPhase: phase,
});

export const getLambdaConnectionErrorDetails = (
  connection: LambdaConnectionState
): string[] => {
  return [
    "Could not validate the Record Bin lambda deployment.",
    `Health check phase: ${connection.lastCheckPhase}.`,
    `Endpoint called: ${connection.endpoint}.`,
    connection.errorCode ? `Failure code: ${connection.errorCode}.` : "",
    connection.errorMessage ? `Failure details: ${connection.errorMessage}` : "",
    connection.httpStatus ? `HTTP status: ${connection.httpStatus}.` : "",
    connection.responseSnippet
      ? `Response snippet: ${connection.responseSnippet}`
      : "",
    buildUnexpectedResponseMessage(),
    "If this worked before, the deployment may have been deleted or is no longer healthy on your chosen platform.",
    "Confirm /api/datocms/plugin-health exists and returns the expected MPI PONG payload.",
  ].filter(Boolean);
};

export const getHealthEndpointFromBaseUrl = (baseUrl: string): string =>
  getFallbackEndpoint(baseUrl);
