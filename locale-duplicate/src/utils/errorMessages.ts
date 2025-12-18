/**
 * Error message templates with placeholders for better context
 */

export interface ErrorContext {
  modelName?: string;
  fieldName?: string;
  recordId?: string;
  sourceLocale?: string;
  targetLocale?: string;
  errorDetails?: string;
  errorCode?: string;
}

/**
 * Error message templates
 */
export const ERROR_TEMPLATES = {
  RECORD_UPDATE_FAILED: (ctx: ErrorContext) => 
    `Failed to update record ${ctx.recordId ? `(ID: ${ctx.recordId})` : ''} in model "${ctx.modelName || 'Unknown'}"${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  FIELD_COPY_FAILED: (ctx: ErrorContext) => 
    `Failed to copy field "${ctx.fieldName || 'Unknown'}" from ${ctx.sourceLocale || 'source'} to ${ctx.targetLocale || 'target'}${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  MODEL_PROCESSING_FAILED: (ctx: ErrorContext) => 
    `Error processing model "${ctx.modelName || 'Unknown'}"${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  PUBLISH_FAILED: (ctx: ErrorContext) => 
    `Failed to publish records${ctx.modelName ? ` in model "${ctx.modelName}"` : ''}${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  API_REQUEST_FAILED: (ctx: ErrorContext) => 
    `API request failed${ctx.errorCode ? ` (Error ${ctx.errorCode})` : ''}${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  CONFIGURATION_INVALID: (ctx: ErrorContext) => 
    `Invalid configuration${ctx.fieldName ? ` for field "${ctx.fieldName}"` : ''}${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  LOCALE_NOT_FOUND: (ctx: ErrorContext) => 
    `Locale "${ctx.targetLocale || ctx.sourceLocale || 'Unknown'}" not found${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
  
  PERMISSION_DENIED: (ctx: ErrorContext) => 
    `Permission denied${ctx.modelName ? ` for model "${ctx.modelName}"` : ''}${ctx.errorDetails ? `: ${ctx.errorDetails}` : ''}`,
} as const;

/**
 * Error codes for support reference
 */
export enum ErrorCode {
  UPDATE_FAILED = 'ERR_UPDATE_001',
  FIELD_COPY_FAILED = 'ERR_FIELD_001',
  MODEL_PROCESSING_FAILED = 'ERR_MODEL_001',
  PUBLISH_FAILED = 'ERR_PUBLISH_001',
  API_REQUEST_FAILED = 'ERR_API_001',
  CONFIGURATION_INVALID = 'ERR_CONFIG_001',
  LOCALE_NOT_FOUND = 'ERR_LOCALE_001',
  PERMISSION_DENIED = 'ERR_PERM_001',
}

/**
 * Format error message with context
 */
export function formatErrorMessage(
  template: keyof typeof ERROR_TEMPLATES,
  context: ErrorContext
): string {
  const errorCodeKey = template as keyof typeof ErrorCode;
  const errorCode = ErrorCode[errorCodeKey] || '';
  const message = ERROR_TEMPLATES[template](context);
  
  return `${message} [${errorCode}]`;
}

/**
 * Create error with context
 */
export function createContextualError(
  template: keyof typeof ERROR_TEMPLATES,
  context: ErrorContext,
  originalError?: unknown
): Error {
  const message = formatErrorMessage(template, {
    ...context,
    errorDetails: context.errorDetails || getErrorDetails(originalError)
  });
  
  const error = new Error(message);
  error.name = template;
  
  return error;
}

/**
 * Extract error details from various error types
 */
function getErrorDetails(error: unknown): string {
  if (!error) return '';
  
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (typeof error === 'object' && error !== null) {
    // Handle DatoCMS API errors
    if ('message' in error) {
      return String(error.message);
    }
    
    // Handle other structured errors
    if ('error' in error) {
      return getErrorDetails(error.error);
    }
  }
  
  return String(error);
}