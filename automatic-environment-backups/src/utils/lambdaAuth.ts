export const LAMBDA_AUTH_HEADER_NAME = 'X-Datocms-Backups-Auth';

export class LambdaAuthSecretError extends Error {
  constructor(message = 'Lambda auth secret is required.') {
    super(message);
    this.name = 'LambdaAuthSecretError';
  }
}

export const normalizeLambdaAuthSecret = (value: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new LambdaAuthSecretError(
      'Lambda auth secret is required. Set it in plugin settings before calling lambda endpoints.',
    );
  }
  return normalized;
};

const extractEnvelopeError = (
  payload: string,
): { code?: string; message?: string } => {
  try {
    const parsed = JSON.parse(payload) as {
      error?: {
        code?: unknown;
        message?: unknown;
      };
      message?: unknown;
    };

    return {
      code:
        typeof parsed.error?.code === 'string' ? parsed.error.code : undefined,
      message:
        typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : typeof parsed.message === 'string'
            ? parsed.message
            : undefined,
    };
  } catch {
    return {};
  }
};

const buildAuthHint = (errorCode: string | undefined): string => {
  if (errorCode === 'UNAUTHORIZED') {
    return ' Confirm plugin Lambda auth secret matches DATOCMS_BACKUPS_SHARED_SECRET.';
  }

  if (errorCode === 'MISSING_SHARED_SECRET_CONFIG') {
    return ' Configure DATOCMS_BACKUPS_SHARED_SECRET in the lambda deployment.';
  }

  return '';
};

export const buildLambdaHttpErrorMessage = (
  status: number,
  payload: string,
  defaultMessage: string,
): string => {
  const { code, message } = extractEnvelopeError(payload);
  const hint = buildAuthHint(code);

  if (code && message) {
    return `HTTP ${status}: ${code} - ${message}.${hint}`;
  }

  if (message) {
    return `HTTP ${status}: ${message}.${hint}`;
  }

  return `HTTP ${status}: ${defaultMessage}.${hint}`;
};

export const buildLambdaJsonHeaders = (
  lambdaAuthSecret: string,
): Record<string, string> => {
  const normalizedSecret = normalizeLambdaAuthSecret(lambdaAuthSecret);
  return {
    Accept: '*/*',
    'Content-Type': 'application/json',
    [LAMBDA_AUTH_HEADER_NAME]: normalizedSecret,
  };
};
