import type { errorObject } from '../types/types';

const UNKNOWN_ERROR_CODE = 'UNKNOWN';
const DEFAULT_FALLBACK_MESSAGE = 'Could not parse restoration error payload.';

type BuildRestoreErrorPayloadOptions = {
  fullErrorPayload?: string;
  fallbackMessage?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const serializeUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

const isErrorObject = (value: unknown): value is errorObject => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.fullErrorPayload !== 'string') {
    return false;
  }

  if (!isRecord(value.simplifiedError)) {
    return false;
  }

  return isRecord(value.simplifiedError.details);
};

const buildUnknownSimplifiedError = (
  error: unknown,
  fallbackMessage: string,
): errorObject['simplifiedError'] => {
  const message = isNonEmptyString(error)
    ? error
    : error instanceof Error && isNonEmptyString(error.message)
      ? error.message
      : fallbackMessage;

  return {
    code: UNKNOWN_ERROR_CODE,
    details: {
      code: UNKNOWN_ERROR_CODE,
      message,
    },
  };
};

const normalizeSimplifiedErrorRecord = (
  candidate: Record<string, unknown>,
  fallbackMessage: string,
): errorObject['simplifiedError'] | undefined => {
  const candidateDetails = isRecord(candidate.details)
    ? { ...candidate.details }
    : {};
  const hasStructuredShape =
    isNonEmptyString(candidate.code) ||
    Object.keys(candidateDetails).length > 0;

  if (!hasStructuredShape) {
    if (isNonEmptyString(candidate.message)) {
      return {
        code: UNKNOWN_ERROR_CODE,
        details: {
          code: UNKNOWN_ERROR_CODE,
          message: candidate.message,
        },
      };
    }

    return undefined;
  }

  const code = isNonEmptyString(candidate.code)
    ? candidate.code
    : UNKNOWN_ERROR_CODE;
  const details: Record<string, unknown> = { ...candidateDetails };

  if (!isNonEmptyString(details.code)) {
    details.code = code;
  }

  if (
    !isNonEmptyString(details.message) &&
    isNonEmptyString(candidate.message)
  ) {
    details.message = candidate.message;
  }

  if (
    Object.keys(details).length === 1 &&
    details.code === UNKNOWN_ERROR_CODE &&
    !isNonEmptyString(details.message)
  ) {
    details.message = fallbackMessage;
  }

  return {
    ...candidate,
    code,
    details,
  } as errorObject['simplifiedError'];
};

const unwrapErrorWrapper = (error: unknown): unknown => {
  let current = error;

  while (isRecord(current) && 'error' in current) {
    const nestedError = current.error;
    if (nestedError === undefined || nestedError === current) {
      break;
    }

    current = nestedError;
  }

  return current;
};

const extractSimplifiedError = (
  error: unknown,
  fallbackMessage: string,
): errorObject['simplifiedError'] => {
  if (isErrorObject(error)) {
    return error.simplifiedError;
  }

  const unwrappedError = unwrapErrorWrapper(error);

  if (isErrorObject(unwrappedError)) {
    return unwrappedError.simplifiedError;
  }

  if (isRecord(unwrappedError) && Array.isArray(unwrappedError.errors)) {
    const firstError = unwrappedError.errors[0];
    if (isRecord(firstError) && isRecord(firstError.attributes)) {
      const normalizedAttributes = normalizeSimplifiedErrorRecord(
        firstError.attributes,
        fallbackMessage,
      );
      if (normalizedAttributes) {
        return normalizedAttributes;
      }
    }
  }

  if (isRecord(unwrappedError)) {
    const normalizedError = normalizeSimplifiedErrorRecord(
      unwrappedError,
      fallbackMessage,
    );
    if (normalizedError) {
      return normalizedError;
    }
  }

  return buildUnknownSimplifiedError(unwrappedError, fallbackMessage);
};

export const parseJsonStringSafely = (
  rawResponseText: string,
): unknown | undefined => {
  if (!isNonEmptyString(rawResponseText)) {
    return undefined;
  }

  try {
    return JSON.parse(rawResponseText);
  } catch {
    return undefined;
  }
};

export const buildRestoreErrorPayload = (
  error: unknown,
  options: BuildRestoreErrorPayloadOptions = {},
): errorObject => {
  const { fullErrorPayload, fallbackMessage = DEFAULT_FALLBACK_MESSAGE } =
    options;

  if (isErrorObject(error) && !isNonEmptyString(fullErrorPayload)) {
    return error;
  }

  return {
    simplifiedError: extractSimplifiedError(error, fallbackMessage),
    fullErrorPayload: fullErrorPayload ?? serializeUnknownError(error),
  };
};

export type RestoreSuccessResponse = {
  restoredRecord: {
    id: string;
    modelID: string;
  };
};

export const isRestoreSuccessResponse = (
  payload: unknown,
): payload is RestoreSuccessResponse => {
  if (!isRecord(payload)) {
    return false;
  }

  if (!isRecord(payload.restoredRecord)) {
    return false;
  }

  return (
    isNonEmptyString(payload.restoredRecord.id) &&
    isNonEmptyString(payload.restoredRecord.modelID)
  );
};
