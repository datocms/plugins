import type {
  CentraConnection,
  CentraFieldParametersV1,
  CentraPluginParametersV2,
  CentraReferenceKind,
} from '../types';

export const EMPTY_CONNECTION: CentraConnection = {
  endpoint: '',
  token: '',
};

export const DEFAULT_FIELD_PARAMETERS: CentraFieldParametersV1 = {
  paramsVersion: '1',
  kind: 'primaryProduct',
  cardinality: 'single',
};

export type ConnectionValidationResult = {
  valid: boolean;
  errors: Partial<Record<'endpoint' | 'token', string>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeConnection(value: unknown): CentraConnection {
  if (!isRecord(value)) {
    return { ...EMPTY_CONNECTION };
  }

  return {
    endpoint: normalizedString(value.endpoint),
    token: normalizedString(value.token),
  };
}

export function normalizePluginParameters(
  value: unknown,
): CentraPluginParametersV2 {
  const raw = isRecord(value) ? value : {};
  let connection = isRecord(raw.defaultConnection)
    ? normalizeConnection(raw.defaultConnection)
    : normalizeConnection(raw);

  if (
    (!connection.endpoint || !connection.token) &&
    isRecord(raw.connectionsByEnvironment)
  ) {
    for (const candidate of Object.values(raw.connectionsByEnvironment)) {
      const normalized = normalizeConnection(candidate);
      if (normalized.endpoint && normalized.token) {
        connection = normalized;
        break;
      }
    }
  }

  return {
    paramsVersion: '2',
    ...connection,
  };
}

function isReferenceKind(value: unknown): value is CentraReferenceKind {
  return value === 'primaryProduct' || value === 'variant' || value === 'item';
}

export function normalizeFieldParameters(
  value: unknown,
): CentraFieldParametersV1 {
  if (!isRecord(value)) {
    return { ...DEFAULT_FIELD_PARAMETERS };
  }

  return {
    paramsVersion: '1',
    kind: isReferenceKind(value.kind)
      ? value.kind
      : DEFAULT_FIELD_PARAMETERS.kind,
    cardinality:
      value.cardinality === 'multiple'
        ? 'multiple'
        : DEFAULT_FIELD_PARAMETERS.cardinality,
  };
}

/** Returns an actionable validation message, or null when the URL is usable. */
export function validateEndpoint(endpoint: string): string | null {
  const normalized = endpoint.trim();
  if (normalized.length === 0) {
    return 'Enter the Centra Storefront GraphQL endpoint.';
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return 'Enter a valid absolute URL.';
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return 'Do not include credentials in the endpoint URL.';
  }

  if (url.hash.length > 0) {
    return 'Remove the fragment from the endpoint URL.';
  }

  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocalHttp) {
    return 'Use an HTTPS endpoint (HTTP is allowed only for localhost).';
  }

  return null;
}

export function validateConnection(
  connectionValue: unknown,
): ConnectionValidationResult {
  const connection = normalizeConnection(connectionValue);
  const errors: ConnectionValidationResult['errors'] = {};
  const endpointError = validateEndpoint(connection.endpoint);
  if (endpointError) {
    errors.endpoint = endpointError;
  }

  if (connection.token.length === 0) {
    errors.token = 'Enter the no-session Storefront API token.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function isConnectionComplete(connection: CentraConnection): boolean {
  return validateConnection(connection).valid;
}

export function resolveConnection(
  parametersValue: unknown,
): CentraConnection {
  const parameters = normalizePluginParameters(parametersValue);
  return { endpoint: parameters.endpoint, token: parameters.token };
}
