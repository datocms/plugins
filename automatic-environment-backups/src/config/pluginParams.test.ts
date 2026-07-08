import { describe, expect, it } from 'vitest';
import type { LambdaConnectionState } from '../types/types';
import {
  DEFAULT_LAMBDA_AUTH_SECRET,
  getProjectTimezone,
  hasStoredBackupSchedule,
  isConnectionHealthy,
  isDefaultAuthSecret,
  readAuthSecret,
  readConnection,
  readDebug,
  readDeploymentUrl,
  readEnabledCadences,
  readValidationMode,
} from './pluginParams';

const connected: LambdaConnectionState = {
  status: 'connected',
  endpoint: 'https://x/api/datocms/plugin-health',
  lastCheckedAt: '2026-06-30T00:00:00.000Z',
  lastCheckPhase: 'config_connect',
};

const disconnected: LambdaConnectionState = {
  status: 'disconnected',
  endpoint: 'https://x/api/datocms/plugin-health',
  lastCheckedAt: '2026-06-30T00:00:00.000Z',
  lastCheckPhase: 'config_mount',
  errorCode: 'HTTP',
  errorMessage: 'HTTP 401: UNAUTHORIZED',
  httpStatus: 401,
};

describe('readAuthSecret', () => {
  it('returns the trimmed saved secret', () => {
    expect(readAuthSecret({ lambdaAuthSecret: '  abc123  ' })).toBe('abc123');
  });

  it('returns empty string when unset, blank, or non-string (no superSecretToken default)', () => {
    expect(readAuthSecret(undefined)).toBe('');
    expect(readAuthSecret({})).toBe('');
    expect(readAuthSecret({ lambdaAuthSecret: '   ' })).toBe('');
    expect(readAuthSecret({ lambdaAuthSecret: 123 })).toBe('');
  });
});

describe('isDefaultAuthSecret', () => {
  it('detects the example default so the UI can nudge a rotation', () => {
    expect(isDefaultAuthSecret(DEFAULT_LAMBDA_AUTH_SECRET)).toBe(true);
    expect(isDefaultAuthSecret('superSecretToken')).toBe(true);
    expect(isDefaultAuthSecret('a-real-secret')).toBe(false);
    expect(isDefaultAuthSecret('')).toBe(false);
  });
});

describe('readDeploymentUrl', () => {
  it('prefers deploymentURL, then netlifyURL, then vercelURL', () => {
    expect(
      readDeploymentUrl({
        deploymentURL: 'https://d',
        netlifyURL: 'https://n',
        vercelURL: 'https://v',
      }),
    ).toBe('https://d');
    expect(readDeploymentUrl({ netlifyURL: 'https://n' })).toBe('https://n');
    expect(readDeploymentUrl({ vercelURL: 'https://v' })).toBe('https://v');
  });

  it('trims and returns empty when none configured', () => {
    expect(readDeploymentUrl({ deploymentURL: '  https://d  ' })).toBe(
      'https://d',
    );
    expect(readDeploymentUrl({})).toBe('');
    expect(readDeploymentUrl(undefined)).toBe('');
  });
});

describe('readConnection / readValidationMode', () => {
  it('returns a well-formed connection object or undefined', () => {
    expect(readConnection({ lambdaConnection: connected })).toEqual(connected);
    expect(readConnection({ lambdaConnection: { status: 'bogus' } })).toBeUndefined();
    expect(readConnection({})).toBeUndefined();
  });

  it('only accepts the literal health validation mode', () => {
    expect(readValidationMode({ connectionValidationMode: 'health' })).toBe(
      'health',
    );
    expect(readValidationMode({ connectionValidationMode: 'other' })).toBeUndefined();
    expect(readValidationMode({})).toBeUndefined();
  });
});

describe('isConnectionHealthy', () => {
  it('is true only when connected AND validation mode is health', () => {
    expect(
      isConnectionHealthy({
        lambdaConnection: connected,
        connectionValidationMode: 'health',
      }),
    ).toBe(true);
    expect(isConnectionHealthy({ lambdaConnection: connected })).toBe(false);
    expect(
      isConnectionHealthy({
        lambdaConnection: disconnected,
        connectionValidationMode: 'health',
      }),
    ).toBe(false);
    expect(isConnectionHealthy({})).toBe(false);
  });
});

describe('readDebug', () => {
  it('is true only for an explicit boolean true', () => {
    expect(readDebug({ debug: true })).toBe(true);
    expect(readDebug({ debug: false })).toBe(false);
    expect(readDebug({ debug: 'true' })).toBe(false);
    expect(readDebug({})).toBe(false);
  });
});

describe('hasStoredBackupSchedule / readEnabledCadences', () => {
  it('detects an explicitly stored schedule (not the derived default)', () => {
    expect(
      hasStoredBackupSchedule({
        backupSchedule: {
          version: 1,
          enabledCadences: ['daily'],
          timezone: 'UTC',
          anchorLocalDate: '2026-06-30',
          updatedAt: '2026-06-30T00:00:00.000Z',
        },
      }),
    ).toBe(true);
    expect(hasStoredBackupSchedule({})).toBe(false);
    expect(hasStoredBackupSchedule({ backupSchedule: null })).toBe(false);
  });

  it('normalizes enabled cadences, defaulting to daily+weekly when absent', () => {
    expect(
      readEnabledCadences({
        backupSchedule: {
          version: 1,
          enabledCadences: ['monthly'],
          timezone: 'UTC',
          anchorLocalDate: '2026-06-30',
          updatedAt: '2026-06-30T00:00:00.000Z',
        },
      }),
    ).toEqual(['monthly']);
    expect(readEnabledCadences({})).toEqual(['daily', 'weekly']);
  });
});

describe('getProjectTimezone', () => {
  it('reads a trimmed site timezone, defaulting to UTC', () => {
    expect(getProjectTimezone({ timezone: '  Europe/Rome ' })).toBe(
      'Europe/Rome',
    );
    expect(getProjectTimezone({})).toBe('UTC');
    expect(getProjectTimezone(null)).toBe('UTC');
  });
});
