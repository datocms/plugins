const LOG_ROOT = 'backup-importer';

type LogMethod = 'log' | 'warn' | 'error';

export type DebugLogger = {
  enabled: boolean;
  namespace: string | null;
  child: (namespace: string) => DebugLogger;
  debug: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

function buildPrefix(namespace: string | null): string {
  if (!namespace) {
    return `[${LOG_ROOT}]`;
  }

  return `[${LOG_ROOT}][${namespace}]`;
}

function emitLog(args: {
  enabled: boolean;
  method: LogMethod;
  namespace: string | null;
  message: string;
  details?: unknown;
}) {
  if (!args.enabled) {
    return;
  }

  const prefix = buildPrefix(args.namespace);
  if (typeof args.details === 'undefined') {
    console[args.method](`${prefix} ${args.message}`);
    return;
  }

  console[args.method](`${prefix} ${args.message}`, args.details);
}

export function createDebugLogger(args: {
  enabled: boolean;
  namespace?: string;
}): DebugLogger {
  const namespace = args.namespace ?? null;

  const logger: DebugLogger = {
    enabled: args.enabled,
    namespace,
    child: (childNamespace: string) => {
      const nextNamespace = namespace
        ? `${namespace}/${childNamespace}`
        : childNamespace;
      return createDebugLogger({
        enabled: args.enabled,
        namespace: nextNamespace,
      });
    },
    debug: (message: string, details?: unknown) => {
      emitLog({
        enabled: args.enabled,
        method: 'log',
        namespace,
        message,
        details,
      });
    },
    warn: (message: string, details?: unknown) => {
      emitLog({
        enabled: args.enabled,
        method: 'warn',
        namespace,
        message,
        details,
      });
    },
    error: (message: string, details?: unknown) => {
      emitLog({
        enabled: args.enabled,
        method: 'error',
        namespace,
        message,
        details,
      });
    },
  };

  return logger;
}
