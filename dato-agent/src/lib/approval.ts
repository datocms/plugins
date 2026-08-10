import {
  createDatoAgentScriptNamespace,
  DATOCMS_MCP_SERVER_LABEL,
  DATOCMS_MCP_UNSAFE_SCRIPT_TOOL,
  type DatoCmsMcpPolicyOptions,
} from './mcpPolicy';

export const READ_ONLY_REJECTION_MESSAGE =
  'Read Only was enabled. No action was taken.' as const;

export type ApprovalRequestLike = {
  name: string;
  arguments: string;
  serverLabel?: string;
};

export type ProjectScope = {
  siteId: string;
  environment: string;
  isEnvironmentPrimary: boolean;
  scriptSessionId?: string;
};

export type ApprovalScopeResult =
  | {
      allowed: true;
      parsedArguments: Record<string, unknown>;
    }
  | {
      allowed: false;
      reason: string;
      parsedArguments?: Record<string, unknown>;
    };

export type McpCallValidationResult =
  | {
      allowed: true;
      disposition: 'auto_approve' | 'require_user_approval';
      parsedArguments: Record<string, unknown>;
    }
  | {
      allowed: false;
      reason: string;
      parsedArguments?: Record<string, unknown>;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && Boolean(value));
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && Boolean(item))
  );
}

function invalid(
  reason: string,
  parsedArguments?: Record<string, unknown>,
): McpCallValidationResult {
  return {
    allowed: false,
    reason,
    ...(parsedArguments ? { parsedArguments } : {}),
  };
}

function validateExactProjectScope(
  args: Record<string, unknown>,
  scope: ProjectScope,
): string | undefined {
  if (args.site_id !== scope.siteId) {
    return 'This action targets a different DatoCMS project and has been blocked.';
  }

  if (scope.isEnvironmentPrimary) {
    if (Object.hasOwn(args, 'environment')) {
      return 'This action specifies an environment while the primary environment is open.';
    }
  } else if (args.environment !== scope.environment) {
    return 'This action targets a different environment and has been blocked.';
  }

  return undefined;
}

function validateScriptName(
  value: unknown,
  scope: ProjectScope,
): string | undefined {
  const namespace = createDatoAgentScriptNamespace(scope);

  if (
    typeof value !== 'string' ||
    !value.startsWith(namespace) ||
    !value.endsWith('.ts') ||
    value.length <= namespace.length + 3
  ) {
    return `Scripts must use the protected ${namespace} namespace and end in .ts.`;
  }

  const relativeName = value.slice(namespace.length);
  if (
    relativeName.startsWith('/') ||
    relativeName.includes('/../') ||
    relativeName.startsWith('../') ||
    !/^[A-Za-z0-9][A-Za-z0-9.%_/-]*\.ts$/.test(relativeName)
  ) {
    return 'The script name contains an invalid or unsafe path.';
  }

  return undefined;
}

function validateGetApiMethods(
  args: Record<string, unknown>,
): string | undefined {
  if (
    !hasOnlyKeys(args, ['methods', 'expand_details', 'expand_types', 'have']) ||
    !Array.isArray(args.methods) ||
    args.methods.length < 1 ||
    args.methods.length > 20
  ) {
    return 'The API-method lookup arguments are invalid.';
  }

  for (const method of args.methods) {
    if (
      !isObject(method) ||
      !hasOnlyKeys(method, ['resource', 'action', 'method']) ||
      typeof method.resource !== 'string' ||
      !method.resource ||
      !isOptionalString(method.action) ||
      !isOptionalString(method.method)
    ) {
      return 'The API-method lookup contains an invalid method coordinate.';
    }
  }

  for (const key of ['expand_details', 'expand_types', 'have'] as const) {
    if (args[key] !== undefined && !isStringArray(args[key])) {
      return `The ${key} argument must be an array of non-empty strings.`;
    }
  }

  return undefined;
}

function validateSchemaArguments(
  args: Record<string, unknown>,
  scope: ProjectScope,
): string | undefined {
  if (
    !hasOnlyKeys(args, [
      'site_id',
      'environment',
      'filter_by_name',
      'filter_by_type',
      'fields_details',
      'include_fieldsets',
      'include_nested_blocks',
      'include_referenced_models',
      'include_embedding_models',
    ])
  ) {
    return 'The schema request contains unsupported arguments.';
  }

  const scopeError = validateExactProjectScope(args, scope);
  if (scopeError) {
    return scopeError;
  }

  if (!isOptionalString(args.filter_by_name)) {
    return 'The schema name filter must be a non-empty string.';
  }

  if (
    args.filter_by_type !== undefined &&
    !['all', 'models_only', 'blocks_only'].includes(String(args.filter_by_type))
  ) {
    return 'The schema type filter is invalid.';
  }

  const fieldsDetails = args.fields_details;
  if (
    fieldsDetails !== undefined &&
    fieldsDetails !== 'basic' &&
    fieldsDetails !== 'complete' &&
    (!Array.isArray(fieldsDetails) ||
      fieldsDetails.some(
        (value) =>
          typeof value !== 'string' ||
          !['validators', 'appearance', 'default_values'].includes(value),
      ))
  ) {
    return 'The schema field-details selection is invalid.';
  }

  for (const key of [
    'include_fieldsets',
    'include_nested_blocks',
    'include_referenced_models',
    'include_embedding_models',
  ] as const) {
    if (!isOptionalBoolean(args[key])) {
      return `The ${key} argument must be a boolean.`;
    }
  }

  return undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Exact scope, namespace, and full-vs-patch validation is intentionally fail-closed in one helper.
function validateScriptArguments(
  args: Record<string, unknown>,
  scope: ProjectScope,
  unsafe: boolean,
): string | undefined {
  if (
    !hasOnlyKeys(args, [
      'site_id',
      'environment',
      'name',
      'body',
      'method_tokens',
      'no_execute',
    ])
  ) {
    return 'The script request contains unsupported arguments.';
  }

  const scopeError = validateExactProjectScope(args, scope);
  if (scopeError) {
    return scopeError;
  }

  const nameError = validateScriptName(args.name, scope);
  if (nameError) {
    return nameError;
  }

  if (!isStringArray(args.method_tokens)) {
    return 'method_tokens must be an array of non-empty strings.';
  }

  if (!isOptionalBoolean(args.no_execute)) {
    return 'no_execute must be a boolean.';
  }

  if (!isObject(args.body)) {
    return 'The script body must be an object.';
  }

  if (args.body.mode === 'full') {
    if (
      !hasOnlyKeys(args.body, ['mode', 'content']) ||
      typeof args.body.content !== 'string' ||
      !args.body.content.trim()
    ) {
      return 'A full script body with non-empty TypeScript content is required.';
    }
    return undefined;
  }

  if (unsafe) {
    return 'Unsafe DatoCMS changes must include the complete script body; patch mode is not allowed.';
  }

  if (
    args.body.mode !== 'patch' ||
    !hasOnlyKeys(args.body, ['mode', 'replacements']) ||
    !Array.isArray(args.body.replacements) ||
    args.body.replacements.length === 0
  ) {
    return 'The safe script body is invalid.';
  }

  for (const replacement of args.body.replacements) {
    if (
      !isObject(replacement) ||
      !hasOnlyKeys(replacement, ['old_str', 'new_str']) ||
      typeof replacement.old_str !== 'string' ||
      !replacement.old_str ||
      typeof replacement.new_str !== 'string'
    ) {
      return 'The safe script contains an invalid replacement.';
    }
  }

  return undefined;
}

function validateViewScript(
  args: Record<string, unknown>,
  scope: ProjectScope,
): string | undefined {
  if (!hasOnlyKeys(args, ['name', 'start_line', 'limit'])) {
    return 'The script-view request contains unsupported arguments.';
  }

  const nameError = validateScriptName(args.name, scope);
  if (nameError) {
    return nameError;
  }

  for (const key of ['start_line', 'limit'] as const) {
    if (
      args[key] !== undefined &&
      (typeof args[key] !== 'number' ||
        !Number.isInteger(args[key]) ||
        args[key] <= 0)
    ) {
      return `${key} must be a positive integer.`;
    }
  }

  return undefined;
}

export function validateMcpToolCall(
  request: ApprovalRequestLike,
  scope: ProjectScope,
  policy: DatoCmsMcpPolicyOptions = {},
): McpCallValidationResult {
  let parsed: unknown;

  if (
    request.serverLabel !== undefined &&
    request.serverLabel !== DATOCMS_MCP_SERVER_LABEL
  ) {
    return invalid('The approval request came from an unexpected MCP server.');
  }

  if (policy.readOnly && request.name === DATOCMS_MCP_UNSAFE_SCRIPT_TOOL) {
    return invalid(READ_ONLY_REJECTION_MESSAGE);
  }

  try {
    parsed = JSON.parse(request.arguments);
  } catch {
    return invalid(
      'The proposed action has invalid arguments and cannot be reviewed.',
    );
  }

  if (!isObject(parsed)) {
    return invalid(
      'The proposed action does not contain a valid argument object.',
    );
  }

  const args = parsed;
  let validationError: string | undefined;

  switch (request.name) {
    case 'list_api_resources':
    case 'whoami':
      validationError = hasOnlyKeys(args, [])
        ? undefined
        : 'This read-only request must not contain arguments.';
      break;
    case 'get_api_methods':
      validationError = validateGetApiMethods(args);
      break;
    case 'get_schema':
      validationError = validateSchemaArguments(args, scope);
      break;
    case 'view_script':
      validationError = validateViewScript(args, scope);
      break;
    case 'upsert_and_execute_safe_script':
      validationError = validateScriptArguments(args, scope, false);
      break;
    case 'upsert_and_execute_unsafe_script':
      validationError = validateScriptArguments(args, scope, true);
      break;
    default:
      return invalid(
        'This DatoCMS operation is not allowed by the host application.',
        args,
      );
  }

  if (validationError) {
    return invalid(validationError, args);
  }

  const disposition =
    request.name === 'upsert_and_execute_unsafe_script'
      ? 'require_user_approval'
      : 'auto_approve';

  return { allowed: true, disposition, parsedArguments: args };
}

export function validateApprovalScope(
  request: ApprovalRequestLike,
  scope: ProjectScope,
  policy: DatoCmsMcpPolicyOptions = {},
): ApprovalScopeResult {
  const validation = validateMcpToolCall(request, scope, policy);

  if (!validation.allowed) {
    return validation;
  }

  if (validation.disposition !== 'require_user_approval') {
    return {
      allowed: false,
      reason:
        'This read-only DatoCMS operation does not require editor approval.',
      parsedArguments: validation.parsedArguments,
    };
  }

  return {
    allowed: true,
    parsedArguments: validation.parsedArguments,
  };
}
