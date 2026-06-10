import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger } from './Logger';

function buildParams(overrides: Partial<ctxParamsType> = {}): ctxParamsType {
  return {
    vendor: 'openai',
    gptModel: 'translation-model',
    apiKey: 'secret-token-123456',
    translationFields: [],
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
    ...overrides,
  };
}

function readPayload(calls: unknown[][]): Record<string, unknown> {
  const value = calls[0]?.[0];
  if (typeof value !== 'string') {
    throw new Error('Expected console output to be a string');
  }
  return JSON.parse(value) as Record<string, unknown>;
}

describe('Logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppresses normal logs when debugging is disabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const groupSpy = vi
      .spyOn(console, 'group')
      .mockImplementation(() => undefined);
    const groupEndSpy = vi
      .spyOn(console, 'groupEnd')
      .mockImplementation(() => undefined);

    createLogger(buildParams(), 'TestSource').info('Hidden', { value: 1 });

    expect(logSpy).not.toHaveBeenCalled();
    expect(groupSpy).not.toHaveBeenCalled();
    expect(groupEndSpy).not.toHaveBeenCalled();
  });

  it('prints one pretty JSON string when debugging is enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    createLogger(buildParams({ enableDebugging: true }), 'TestSource').info(
      'Started',
      { nested: { count: 2 } },
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.length).toBe(1);
    const value = logSpy.mock.calls[0]?.[0];
    expect(typeof value).toBe('string');
    expect(String(value)).toContain('\n  "level": "INFO"');

    const payload = readPayload(logSpy.mock.calls);
    expect(payload.source).toBe('TestSource');
    expect(payload.message).toBe('Started');
    const data = payload.data as { nested: { count: number } };
    expect(data.nested.count).toBe(2);
  });

  it('uses the same copyable JSON format for prompt, response, and warning logs', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = createLogger(
      buildParams({ enableDebugging: true }),
      'ProviderFlow',
    );

    logger.logPrompt('Prompt prepared', 'Translate this value');
    logger.logResponse('Response received', { text: 'Translated value' });
    logger.warning('Retry scheduled', { attempt: 2 });

    expect(logSpy).toHaveBeenCalledTimes(3);
    const levels = logSpy.mock.calls.map((call) => {
      const value = call[0];
      if (typeof value !== 'string') {
        throw new Error('Expected console output to be a string');
      }
      return (JSON.parse(value) as { level: string }).level;
    });
    expect(levels).toEqual(['PROMPT', 'RESPONSE', 'WARNING']);
  });

  it('redacts configured secrets and sensitive keys', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const secret = 'secret-token-123456';

    createLogger(
      buildParams({
        apiKey: secret,
        enableDebugging: true,
      }),
      'Redaction',
    ).info(`Using ${secret}`, {
      authorization: `Bearer ${secret}`,
      nested: { text: `Value ${secret}` },
    });

    const raw = String(logSpy.mock.calls[0]?.[0]);
    expect(raw).not.toContain(secret);
    expect(raw).toContain('[REDACTED]');

    const payload = readPayload(logSpy.mock.calls);
    expect(payload.message).toBe('Using [REDACTED]');
    const data = payload.data as {
      authorization: string;
      nested: { text: string };
    };
    expect(data.authorization).toBe('Bea…[REDACTED]');
    expect(data.nested.text).toBe('Value [REDACTED]');
  });

  it('serializes errors as copyable JSON', () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const secret = 'secret-token-123456';
    const err = new Error(`Provider failed with ${secret}`) as Error & {
      apiKey: string;
      code: string;
    };
    err.apiKey = secret;
    err.code = 'provider_error';

    createLogger(buildParams({ apiKey: secret }), 'Errors').error(
      `Failed ${secret}`,
      err,
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.length).toBe(1);
    const raw = String(errorSpy.mock.calls[0]?.[0]);
    expect(raw).not.toContain(secret);

    const payload = readPayload(errorSpy.mock.calls);
    expect(payload.level).toBe('ERROR');
    expect(payload.message).toBe('Failed [REDACTED]');
    const serializedError = payload.error as {
      name: string;
      message: string;
      apiKey: string;
      code: string;
    };
    expect(serializedError.name).toBe('Error');
    expect(serializedError.message).toBe('Provider failed with [REDACTED]');
    expect(serializedError.apiKey).toBe('sec…[REDACTED]');
    expect(serializedError.code).toBe('provider_error');
  });

  it('does not throw when data contains circular references', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const data: { label: string; self?: unknown } = { label: 'root' };
    data.self = data;
    const logger = createLogger(
      buildParams({ enableDebugging: true }),
      'Circular',
    );

    expect(() => logger.info('Circular data', data)).not.toThrow();

    const payload = readPayload(logSpy.mock.calls);
    const serializedData = payload.data as { label: string; self: string };
    expect(serializedData.label).toBe('root');
    expect(serializedData.self).toBe('[Circular]');
  });
});
