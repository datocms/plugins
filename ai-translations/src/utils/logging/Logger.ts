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

/**
 * Available log levels with corresponding colors for clear visual distinction.
 */
const LOG_LEVELS = {
  INFO: { label: 'INFO', color: '#4a90e2' },
  PROMPT: { label: 'PROMPT', color: '#50e3c2' },
  RESPONSE: { label: 'RESPONSE', color: '#b8e986' },
  WARNING: { label: 'WARNING', color: '#f5a623' },
  ERROR: { label: 'ERROR', color: '#d0021b' },
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
      (pluginParams as any).googleApiKey,
    ].filter(Boolean) as string[];
    // Only keep reasonably long secrets to avoid redacting trivial words
    this.secrets = candidates.filter((s) => typeof s === 'string' && s.length >= 8);
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

  private sanitize(data: LoggableData, depth = 0): LoggableData {
    if (typeof data === 'string') return this.redactString(data);
    if (data == null) return data;
    if (depth > 3) return '[Object]';
    if (Array.isArray(data)) return data.map((v) => this.sanitize(v, depth + 1));
    if (typeof data === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        const keyLower = k.toLowerCase();
        if (keyLower.includes('apikey') || keyLower.includes('api_key') || keyLower.includes('authorization') || keyLower.includes('token') || keyLower.includes('secret')) {
          out[k] = typeof v === 'string' && v.length > 4 ? `${(v as string).slice(0, 3)}…[REDACTED]` : '[REDACTED]';
        } else if (typeof v === 'string') {
          out[k] = this.redactString(v);
        } else {
          out[k] = this.sanitize(v as LoggableData, depth + 1);
        }
      }
      return out;
    }
    return data;
  }

  /**
   * Format and print a log message with a consistent style.
   * 
   * @param level - The log level (INFO, PROMPT, etc.)
   * @param message - The message to log
   * @param data - Optional data to include in the log
   * @private
   */
  private log(level: keyof typeof LOG_LEVELS, message: string, data?: LoggableData): void {
    if (!this.enabled) return;

    const logConfig = LOG_LEVELS[level];
    const timestamp = new Date().toISOString();
    
    console.group(
      `%c ${timestamp} %c ${logConfig.label} %c ${this.source} %c ${message}`,
      'background: #333; color: white; padding: 2px 4px;',
      `background: ${logConfig.color}; color: white; padding: 2px 4px;`,
      'background: #666; color: white; padding: 2px 4px;',
      'color: black; padding: 2px 0;'
    );
    
    if (data !== undefined) {
      console.log(this.sanitize(data));
    }
    
    console.groupEnd();
  }

  /**
   * Log general information.
   */
  info(message: string, data?: LoggableData): void {
    this.log('INFO', message, data);
  }

  /**
   * Log a prompt being sent to OpenAI.
   */
  logPrompt(message: string, prompt: string): void {
    this.log('PROMPT', message, prompt);
  }

  /**
   * Log a response received from OpenAI.
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
    // Errors are always logged, even if debugging is disabled
    const sanitized = this.sanitize(error);
    const redactedMsg = this.redactString(message);
    console.error(`${this.source}: ${redactedMsg}`, sanitized);
    // Also log in our format if debugging is enabled
    if (this.enabled) {
      this.log('ERROR', redactedMsg, sanitized);
    }
  }
}

/**
 * Create a logger instance for a specific module.
 * 
 * @param pluginParams - Plugin parameters with enableDebugging setting
 * @param source - Source module identifier
 */
export function createLogger(pluginParams: ctxParamsType, source: string): Logger {
  return new Logger(pluginParams, source);
}
