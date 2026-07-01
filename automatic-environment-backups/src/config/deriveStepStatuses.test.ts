import { describe, expect, it } from 'vitest';
import type {
  BackupScheduleConfig,
  LambdaBackupStatus,
  LambdaConnectionState,
} from '../types/types';
import { buildStatusChecklist, deriveStepStatuses } from './deriveStepStatuses';

const connected: LambdaConnectionState = {
  status: 'connected',
  endpoint: 'https://x/api/datocms/plugin-health',
  lastCheckedAt: '2026-06-30T00:00:00.000Z',
  lastCheckPhase: 'config_connect',
};

const failedPing: LambdaConnectionState = {
  status: 'disconnected',
  endpoint: 'https://x/api/datocms/plugin-health',
  lastCheckedAt: '2026-06-30T00:00:00.000Z',
  lastCheckPhase: 'config_mount',
  errorCode: 'HTTP',
  errorMessage: 'HTTP 401: UNAUTHORIZED - Missing or invalid header.',
  httpStatus: 401,
};

const storedSchedule: BackupScheduleConfig = {
  version: 1,
  enabledCadences: ['daily', 'weekly'],
  timezone: 'UTC',
  anchorLocalDate: '2026-06-30',
  updatedAt: '2026-06-30T00:00:00.000Z',
};

const freshInstall = {};
const secretOnly = { lambdaAuthSecret: 'a-real-secret' };
const connectionFailed = {
  lambdaAuthSecret: 'a-real-secret',
  deploymentURL: 'https://x',
  lambdaConnection: failedPing,
  connectionValidationMode: null,
};
const connectedNoSchedule = {
  lambdaAuthSecret: 'a-real-secret',
  deploymentURL: 'https://x',
  lambdaConnection: connected,
  connectionValidationMode: 'health',
};
const fullyConfigured = {
  ...connectedNoSchedule,
  backupSchedule: storedSchedule,
};
const brokeSinceLastVisit = {
  ...fullyConfigured,
  lambdaConnection: failedPing,
  connectionValidationMode: null,
};

describe('deriveStepStatuses', () => {
  it('fresh install: secret is current, later steps disabled', () => {
    expect(deriveStepStatuses(freshInstall)).toEqual({
      secret: 'current',
      connect: 'disabled',
      schedule: 'disabled',
      currentStep: 'secret',
    });
  });

  it('secret saved: connect becomes current, schedule still disabled', () => {
    expect(deriveStepStatuses(secretOnly)).toEqual({
      secret: 'ok',
      connect: 'current',
      schedule: 'disabled',
      currentStep: 'connect',
    });
  });

  it('failed ping: connect is error and is the current focus', () => {
    expect(deriveStepStatuses(connectionFailed)).toEqual({
      secret: 'ok',
      connect: 'error',
      schedule: 'disabled',
      currentStep: 'connect',
    });
  });

  it('connected without a saved schedule: schedule is current', () => {
    expect(deriveStepStatuses(connectedNoSchedule)).toEqual({
      secret: 'ok',
      connect: 'ok',
      schedule: 'current',
      currentStep: 'schedule',
    });
  });

  it('fully configured: everything ok, no current step', () => {
    expect(deriveStepStatuses(fullyConfigured)).toEqual({
      secret: 'ok',
      connect: 'ok',
      schedule: 'ok',
      currentStep: null,
    });
  });

  it('broke since last visit: connect flips to error and takes focus; schedule re-gates', () => {
    const statuses = deriveStepStatuses(brokeSinceLastVisit);
    expect(statuses.connect).toBe('error');
    expect(statuses.schedule).toBe('disabled');
    expect(statuses.currentStep).toBe('connect');
  });
});

describe('buildStatusChecklist', () => {
  it('fresh install: everything pending', () => {
    const items = buildStatusChecklist(freshInstall);
    expect(items.map((item) => [item.id, item.status])).toEqual([
      ['secret', 'pending'],
      ['connection', 'pending'],
      ['cadence', 'pending'],
      ['environments', 'pending'],
    ]);
  });

  it('warns when the secret is still the example default', () => {
    const items = buildStatusChecklist({
      lambdaAuthSecret: 'superSecretToken',
    });
    const secret = items.find((item) => item.id === 'secret');
    expect(secret?.status).toBe('warn');
  });

  it('surfaces the connection error message redundantly', () => {
    const connection = buildStatusChecklist(connectionFailed).find(
      (item) => item.id === 'connection',
    );
    expect(connection?.status).toBe('error');
    expect(connection?.detail).toContain('401');
  });

  it('reports created environments once a backup status is available', () => {
    const backupStatus = {
      scheduler: { provider: 'netlify', cadence: 'daily' },
      slots: {
        daily: {
          scope: 'daily',
          executionMode: 'lambda_cron',
          lastBackupAt: '2026-06-29T02:05:00.000Z',
          nextBackupAt: '2026-06-30T02:05:00.000Z',
        },
        weekly: {
          scope: 'weekly',
          executionMode: 'lambda_cron',
          lastBackupAt: null,
          nextBackupAt: '2026-07-05T02:05:00.000Z',
        },
      },
      checkedAt: '2026-06-30T00:00:00.000Z',
    } as LambdaBackupStatus;

    const environments = buildStatusChecklist(
      fullyConfigured,
      backupStatus,
    ).find((item) => item.id === 'environments');
    expect(environments?.status).toBe('pending');
    expect(environments?.detail).toContain('1 of 2');
  });
});
