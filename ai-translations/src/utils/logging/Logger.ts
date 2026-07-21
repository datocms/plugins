/**
 * Logger.ts
 * A utility for consistent logging throughout the plugin.
 * Logs are only displayed when debugging is enabled in the plugin settings.
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

/**
 * Type for data that can be logged
 */
type LoggableData = unknown;

type LogLevel =
  | 'INFO'
  | 'PROMPT'
  | 'REQUEST'
  | 'RESPONSE'
  | 'WARNING'
  | 'ERROR';

type LogPayload = {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: LoggableData;
  error?: LoggableData;
};

/**
 * Logger class for consistent debugging and logging.
 */
export class Logger {
  private enabled: boolean;
  private source: string;
  private secrets: string[] = [];

  /**
   * Creates a new logger instance.
   *
   * @param pluginParams - Plugin parameters containing enableDebugging flag
   * @param source - Source module name for this logger instance
   */
  constructor(pluginParams: ctxParamsType, source: string) {
    this.enabled = pluginParams.enableDebugging ?? false;
    this.source = source;
    // Collect known secrets for redaction
    const candidates = [
      pluginParams.apiKey,
      pluginParams.googleApiKey,
      pluginParams.anthropicApiKey,
      pluginParams.deeplApiKey,
      pluginParams.yandexApiKey,
    ].filter((s): s is string => typeof s === 'string' && s.length > 0);
    // Only keep reasonably long secrets to avoid redacting trivial words
    this.secrets = candidates.filter(
      (s) => typeof s === 'string' && s.length >= 8,
    );
  }

  private redactString(s: string): string {
    let out = s;
    for (const secret of this.secrets) {
      if (!secret) continue;
      const safe = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(safe, 'g'), '[REDACTED]');
    }
    return out;
  }

  private isSensitiveKey(key: string): boolean {
    const k = key.toLowerCase().replace(/[_-]/g, '');
    if (k === 'fieldapikey') return false;
    return (
      k === 'apikey' ||
      k.endsWith('apikey') ||
      k.includes('authorization') ||
      k === 'token' ||
      k.endsWith('token') ||
      k.includes('secret')
    );
  }

  private sanitizeObjectEntry(
    key: string,
    value: unknown,
    seen: WeakSet<object>,
  ): unknown {
    if (this.isSensitiveKey(key)) {
      return typeof value === 'string' && value.length > 4
        ? `${value.slice(0, 3)}…[REDACTED]`
        : '[REDACTED]';
    }
    if (typeof value === 'string') return this.redactString(value);
    return this.sanitize(value as LoggableData, seen);
  }

  private sanitizeArray(data: unknown[], seen: WeakSet<object>): LoggableData {
    if (seen.has(data)) return '[Circular]';
    seen.add(data);
    const out = data.map((v) => this.sanitize(v, seen));
    seen.delete(data);
    return out;
  }

  private sanitizeRecord(data: object, seen: WeakSet<object>): LoggableData {
    if (seen.has(data)) return '[Circular]';
    seen.add(data);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = this.sanitizeObjectEntry(k, v, seen);
    }
    seen.delete(data);
    return out;
  }

  private sanitize(data: LoggableData, seen = new WeakSet<object>()): LoggableData {
    if (typeof data === 'string') return this.redactString(data);
    if (data == null) return data;
    if (typeof data === 'bigint') return data.toString();
    if (typeof data === 'symbol') return data.toString();
    if (typeof data === 'function') {
      return data.name ? `[Function ${data.name}]` : '[Function]';
    }
    if (data instanceof Date) return data.toISOString();
    if (data instanceof Error) return this.sanitizeError(data, seen);
    if (Array.isArray(data)) return this.sanitizeArray(data, seen);
    if (typeof data === 'object') return this.sanitizeRecord(data, seen);
    return data;
  }

  private sanitizeError(error: Error, seen: WeakSet<object>): LoggableData {
    if (seen.has(error)) return '[Circular]';
    seen.add(error);

    const out: Record<string, unknown> = {
      name: this.redactString(error.name),
      message: this.redactString(error.message),
    };

    if (error.stack) {
      out.stack = this.redactString(error.stack);
    }

    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.cause = this.sanitize(cause, seen);
    }

    for (const [key, value] of Object.entries(
      error as unknown as Record<string, unknown>,
    )) {
      out[key] = this.sanitizeObjectEntry(key, value, seen);
    }

    seen.delete(error);
    return out;
  }

  private payloadToJson(payload: LogPayload): string {
    return JSON.stringify(this.sanitize(payload), null, 2);
  }

  private buildPayload(
    level: LogLevel,
    message: string,
    value?: { key: 'data' | 'error'; payload: LoggableData },
  ): LogPayload {
    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      source: this.source,
      message: this.redactString(message),
    };

    if (value) {
      payload[value.key] = value.payload;
    }

    return payload;
  }

  /**
   * Format and print one copyable JSON string.
   *
   * @param level - The log level
   * @param message - The message to log
   * @param data - Optional data to include in the log
   * @private
   */
  private log(level: LogLevel, message: string, data?: LoggableData): void {
    if (!this.enabled) return;
    console.log(
      this.payloadToJson(
        this.buildPayload(
          level,
          message,
          data === undefined ? undefined : { key: 'data', payload: data },
        ),
      ),
    );
  }

  /**
   * Log general information.
   */
  info(message: string, data?: LoggableData): void {
    this.log('INFO', message, data);
  }

  /**
   * Log a prompt being sent to the selected provider.
   */
  logPrompt(message: string, prompt: string): void {
    this.log('PROMPT', message, prompt);
  }

  /**
   * Log a request payload being sent to the selected provider.
   */
  logRequest(message: string, request: LoggableData): void {
    this.log('REQUEST', message, request);
  }

  /**
   * Log a response received from the selected provider.
   */
  logResponse(message: string, response: LoggableData): void {
    this.log('RESPONSE', message, response);
  }

  /**
   * Log a warning.
   */
  warning(message: string, data?: LoggableData): void {
    this.log('WARNING', message, data);
  }

  /**
   * Log an error (always visible regardless of debug setting).
   */
  error(message: string, error?: LoggableData): void {
    console.error(
      this.payloadToJson(
        this.buildPayload(
          'ERROR',
          message,
          error === undefined ? undefined : { key: 'error', payload: error },
        ),
      ),
    );
  }
}

/**
 * Create a logger instance for a specific module.
 *
 * @param pluginParams - Plugin parameters with enableDebugging setting
 * @param source - Source module identifier
 */
export function createLogger(
  pluginParams: ctxParamsType,
  source: string,
): Logger {
  return new Logger(pluginParams, source);
}
