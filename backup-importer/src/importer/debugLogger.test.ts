/// <reference types="vitest" />

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDebugLogger } from './debugLogger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDebugLogger', () => {
  test('does not emit logs when disabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDebugLogger({ enabled: false, namespace: 'executor' });

    logger.debug('debug');
    logger.warn('warn');
    logger.error('error');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('emits namespaced logs when enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDebugLogger({ enabled: true })
      .child('executor')
      .child('schema');

    logger.debug('phase start', { phase: 'field-import-pass-b' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toContain('[backup-importer][executor/schema]');
    expect(logSpy.mock.calls[0]?.[0]).toContain('phase start');
    expect(logSpy.mock.calls[0]?.[1]).toEqual({ phase: 'field-import-pass-b' });
  });
});
