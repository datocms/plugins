import type {
  BackupCadence,
  ConnectionValidationMode,
  LambdaConnectionState,
} from '../types/types';
import { normalizeBackupScheduleConfig } from '../utils/backupSchedule';

/**
 * Typed, pure readers over the persisted plugin parameters. These are the single
 * source of truth for the config screen: everything is derived from
 * `ctx.plugin.attributes.parameters`, never from a separate React snapshot that
 * could drift. Keep them free of `ctx`/state so they stay unit-testable.
 */

/** The example secret shipped in docs and the lambda's server-side fallback. */
export const DEFAULT_LAMBDA_AUTH_SECRET = 'superSecretToken';

export type BackupsParameters = Record<string, unknown> | undefined;

const readTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** The saved auth secret, or `''` when unset — no `superSecretToken` default. */
export const readAuthSecret = (params: BackupsParameters): string =>
  readTrimmedString(params?.lambdaAuthSecret);

/** True when a secret is still the shipped example default (worth rotating). */
export const isDefaultAuthSecret = (secret: string): boolean =>
  secret === DEFAULT_LAMBDA_AUTH_SECRET;

/** The saved deployment URL, preferring `deploymentURL` over legacy keys. */
export const readDeploymentUrl = (params: BackupsParameters): string =>
  readTrimmedString(params?.deploymentURL) ||
  readTrimmedString(params?.netlifyURL) ||
  readTrimmedString(params?.vercelURL);

export const readConnection = (
  params: BackupsParameters,
): LambdaConnectionState | undefined => {
  const value = params?.lambdaConnection;
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<LambdaConnectionState>;
  if (
    (candidate.status === 'connected' || candidate.status === 'disconnected') &&
    typeof candidate.endpoint === 'string' &&
    typeof candidate.lastCheckedAt === 'string' &&
    (candidate.lastCheckPhase === 'finish_installation' ||
      candidate.lastCheckPhase === 'config_mount' ||
      candidate.lastCheckPhase === 'config_connect')
  ) {
    return candidate as LambdaConnectionState;
  }

  return undefined;
};

export const readValidationMode = (
  params: BackupsParameters,
): ConnectionValidationMode | undefined =>
  params?.connectionValidationMode === 'health' ? 'health' : undefined;

/** True when the last recorded ping succeeded under the health contract. */
export const isConnectionHealthy = (params: BackupsParameters): boolean =>
  readConnection(params)?.status === 'connected' &&
  readValidationMode(params) === 'health';

export const readDebug = (params: BackupsParameters): boolean =>
  params?.debug === true;

/** True when the user has explicitly persisted a backup schedule. */
export const hasStoredBackupSchedule = (params: BackupsParameters): boolean =>
  typeof params?.backupSchedule === 'object' && params?.backupSchedule !== null;

/** Normalized enabled cadences (defaults to daily+weekly when none stored). */
export const readEnabledCadences = (
  params: BackupsParameters,
  timezoneFallback = 'UTC',
): BackupCadence[] =>
  normalizeBackupScheduleConfig({
    value: params?.backupSchedule,
    timezoneFallback,
  }).config.enabledCadences;

export const getProjectTimezone = (site: unknown): string => {
  if (
    site &&
    typeof site === 'object' &&
    'timezone' in site &&
    typeof (site as { timezone?: unknown }).timezone === 'string' &&
    (site as { timezone: string }).timezone.trim()
  ) {
    return (site as { timezone: string }).timezone.trim();
  }

  return 'UTC';
};
