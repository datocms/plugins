import { normalizeBaseUrlForLegacyFallback } from "./verifyLambdaHealth";

const LEGACY_INITIALIZATION_PATH = "/.netlify/functions/initialization";
const LEGACY_INITIALIZATION_TIMEOUT_MS = 12000;

export class LegacyInitializationError extends Error {
  readonly endpoint: string;
  readonly httpStatus?: number;

  constructor(message: string, endpoint: string, httpStatus?: number) {
    super(message);
    this.name = "LegacyInitializationError";
    this.endpoint = endpoint;
    this.httpStatus = httpStatus;
  }
}

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: string }).name === "AbortError";

export const attemptLegacyInitialization = async (baseUrl: string) => {
  const normalizedBaseUrl = normalizeBaseUrlForLegacyFallback(baseUrl);
  const endpoint = new URL(LEGACY_INITIALIZATION_PATH, `${normalizedBaseUrl}/`).toString();
  const initializedAt = new Date().toISOString();

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    LEGACY_INITIALIZATION_TIMEOUT_MS,
  );

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "*/*" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new LegacyInitializationError(
        `HTTP ${response.status}: legacy initialization endpoint returned an error status.`,
        endpoint,
        response.status,
      );
    }

    return {
      endpoint,
      normalizedBaseUrl,
      initializedAt,
    };
  } catch (error) {
    if (error instanceof LegacyInitializationError) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new LegacyInitializationError(
        `Legacy initialization timed out after ${LEGACY_INITIALIZATION_TIMEOUT_MS}ms.`,
        endpoint,
      );
    }

    throw new LegacyInitializationError(
      "Could not reach the legacy initialization endpoint.",
      endpoint,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};
