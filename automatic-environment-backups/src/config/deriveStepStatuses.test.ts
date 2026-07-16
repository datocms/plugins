import { describe, expect, it } from 'vitest';
import type {
  BackupScheduleConfig,
  LambdaConnectionState,
} from '../types/types';
import { deriveStepStatuses } from './deriveStepStatuses';

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
      deploy: 'disabled',
      connect: 'disabled',
      schedule: 'disabled',
      currentStep: 'secret',
    });
  });

  it('secret saved: deploy becomes current, later steps stay disabled', () => {
    expect(deriveStepStatuses(secretOnly)).toEqual({
      secret: 'ok',
      deploy: 'current',
      connect: 'disabled',
      schedule: 'disabled',
      currentStep: 'deploy',
    });
  });

  it('deployment URL saved: connect becomes current', () => {
    expect(
      deriveStepStatuses({
        lambdaAuthSecret: 'a-real-secret',
        deploymentURL: 'https://x',
      }),
    ).toEqual({
      secret: 'ok',
      deploy: 'ok',
      connect: 'current',
      schedule: 'disabled',
      currentStep: 'connect',
    });
  });

  it('failed ping: connect is error and is the current focus', () => {
    expect(deriveStepStatuses(connectionFailed)).toEqual({
      secret: 'ok',
      deploy: 'ok',
      connect: 'error',
      schedule: 'disabled',
      currentStep: 'connect',
    });
  });

  it('connected without a saved schedule: schedule is current', () => {
    expect(deriveStepStatuses(connectedNoSchedule)).toEqual({
      secret: 'ok',
      deploy: 'ok',
      connect: 'ok',
      schedule: 'current',
      currentStep: 'schedule',
    });
  });

  it('fully configured: everything ok, no current step', () => {
    expect(deriveStepStatuses(fullyConfigured)).toEqual({
      secret: 'ok',
      deploy: 'ok',
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
