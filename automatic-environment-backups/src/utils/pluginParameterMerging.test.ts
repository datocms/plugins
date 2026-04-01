import { describe, expect, it } from 'vitest';
import { mergePluginParameterUpdates } from './pluginParameterMerging';

describe('mergePluginParameterUpdates', () => {
  it('preserves unrelated automaticBackupsSchedule fields', () => {
    const latestParameters = {
      automaticBackupsSchedule: {
        lastErrorByCadence: {
          weekly: 'Backup failed',
        },
      },
    };

    const merged = mergePluginParameterUpdates(latestParameters, {
      backupSchedule: {
        version: 1,
        enabledCadences: ['daily', 'weekly'],
        timezone: 'UTC',
        anchorLocalDate: '2026-02-27',
        updatedAt: '2026-02-27T12:00:00.000Z',
      },
    });

    expect(merged.automaticBackupsSchedule).toEqual(
      latestParameters.automaticBackupsSchedule,
    );
  });
});
