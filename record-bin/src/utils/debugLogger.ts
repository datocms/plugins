type PluginParameters = Record<string, unknown> | undefined;

type LogMethod = 'log' | 'warn' | 'error';

const LOG_PREFIX = '[record-bin]';

export const isDebugEnabled = (parameters: PluginParameters): boolean =>
  parameters?.debug === true;

export const createDebugLogger = (debugEnabled: boolean, scope: string) => {
  const prefix = `${LOG_PREFIX}[${scope}]`;

  const write = (method: LogMethod, ...args: unknown[]) => {
    if (!debugEnabled) {
      return;
    }

    console[method](prefix, ...args);
  };

  return {
    enabled: debugEnabled,
    log: (...args: unknown[]) => write('log', ...args),
    warn: (...args: unknown[]) => write('warn', ...args),
    error: (...args: unknown[]) => write('error', ...args),
  };
};
