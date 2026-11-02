import { ApiError } from '@datocms/cma-client';

/**
 * The raw message of a failure, for the `code` of an error BlankSlate: the
 * code and the status of an API error ("FORBIDDEN · 403"), not its request
 * and body, else the message of the error.
 */
export function errorCode(error: Error) {
  if (!(error instanceof ApiError)) {
    return error.message;
  }
  const code = error.errors[0]?.attributes.code;
  const status = String(error.response.status);
  return code ? `${code} · ${status}` : status;
}

/** The API refused the request: the user lacks a permission */
export function isPermissionError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.response.status === 401 || error.response.status === 403)
  );
}

/**
 * What the user can do about a failed read of the schema, for the
 * description of an error BlankSlate or the alert of a failed export. An
 * error with no answer from DatoCMS (a network failure) is the only one that
 * points to the connection.
 */
export function describeSchemaReadError(error: unknown) {
  if (isPermissionError(error)) {
    return "You don't have permission to read the schema of this environment. Ask an administrator for access.";
  }
  if (!(error instanceof ApiError)) {
    return 'Check your connection, then try again.';
  }
  if (error.response.status === 429) {
    return 'DatoCMS is busy for a moment. Wait a few seconds, then try again.';
  }
  return 'DatoCMS could not answer. Try again in a few moments.';
}

/** The API refused a value of the file that the project already uses */
export function isTakenApiKeyError(error: unknown) {
  return (
    error instanceof ApiError &&
    Boolean(
      error.findError(
        'INVALID_FIELD',
        (details) =>
          details.field === 'api_key' &&
          details.code === 'VALIDATION_UNIQUENESS',
      ),
    )
  );
}
