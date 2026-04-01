import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logDebug,
  logError,
  logWarn,
  setDebugLoggingEnabled,
} from '@/utils/errorLogger';

describe('errorLogger', () => {
  beforeEach(() => {
    setDebugLoggingEnabled(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setDebugLoggingEnabled(false);
    vi.restoreAllMocks();
  });

  it('supports enabling and disabling debug logging at runtime', () => {
    logDebug('before');
    expect(console.info).not.toHaveBeenCalled();

    setDebugLoggingEnabled(true);
    logDebug('enabled');
    expect(console.info).toHaveBeenCalledTimes(1);

    setDebugLoggingEnabled(false);
    logDebug('after');
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it('always logs errors and sanitizes sensitive context', () => {
    const error = new Error('boom');

    logError('Something failed', error, {
      currentUserAccessToken: 'secret-token',
      recordId: 'record-1',
    });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[RecordComments][error] Something failed'),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"currentUserAccessToken": "[redacted]"'),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"recordId": "record-1"'),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"message": "boom"'),
    );
  });

  it('logs debug messages only when verbose logging is enabled', () => {
    logDebug('Hidden debug message');
    expect(console.info).not.toHaveBeenCalled();

    setDebugLoggingEnabled(true);
    logDebug('Visible debug message', {
      cdaToken: 'token-123',
      recordId: 'record-1',
    });

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[RecordComments][debug] Visible debug message'),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"cdaToken": "[redacted]"'),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"recordId": "record-1"'),
    );
  });

  it('logs warnings only when verbose logging is enabled', () => {
    logWarn('Hidden warning');
    expect(console.warn).not.toHaveBeenCalled();

    setDebugLoggingEnabled(true);
    logWarn('Visible warning', {
      content: [{ type: 'text', content: 'secret comment body' }],
      recordId: 'record-1',
    });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[RecordComments][warn] Visible warning'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"content": "[redacted]"'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"recordId": "record-1"'),
    );
  });
});
