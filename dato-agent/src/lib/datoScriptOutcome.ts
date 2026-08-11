export const DATO_SCRIPT_OUTCOME_MARKER_PREFIX =
  'DATOCMS_SCRIPT_OUTCOME_V1:' as const;
export const MAX_DATO_SCRIPT_OUTCOME_MARKER_CHARACTERS = 65_536;
export const MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS = 4_000;
export const MAX_DATO_SCRIPT_NAME_CHARACTERS = 1_024;

export type DatoScriptFailureCode =
  | 'script_validation'
  | 'method_verification'
  | 'typescript_compilation'
  | 'execution'
  | 'sandbox_setup'
  | 'sandbox_unknown'
  | 'project_resolution'
  | 'internal';

export type DatoScriptExecutionState = 'not_started' | 'started' | 'unknown';

export type DatoScriptProjectChangeState = 'none' | 'possible' | 'unknown';

export interface DatoScriptOutcomeV1 {
  version: 1;
  kind: 'dato_script_outcome';
  status: 'failed';
  failureCode: DatoScriptFailureCode;
  executionState: DatoScriptExecutionState;
  projectChangeState: DatoScriptProjectChangeState;
  recovery: 'fix_and_review' | 'none';
  scriptName: string;
  message: string;
}

export interface ExtractedDatoScriptOutcome {
  outcome?: DatoScriptOutcomeV1;
  diagnostic: string;
  contractPresent: boolean;
}

const OUTCOME_KEYS = [
  'version',
  'kind',
  'status',
  'failureCode',
  'executionState',
  'projectChangeState',
  'recovery',
  'scriptName',
  'message',
] as const;

const FAILURE_CODES = new Set<DatoScriptFailureCode>([
  'script_validation',
  'method_verification',
  'typescript_compilation',
  'execution',
  'sandbox_setup',
  'sandbox_unknown',
  'project_resolution',
  'internal',
]);
const EXECUTION_STATES = new Set<DatoScriptExecutionState>([
  'not_started',
  'started',
  'unknown',
]);
const PROJECT_CHANGE_STATES = new Set<DatoScriptProjectChangeState>([
  'none',
  'possible',
  'unknown',
]);

const SENSITIVE_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === OUTCOME_KEYS.length &&
    OUTCOME_KEYS.every((key) => Object.hasOwn(value, key))
  );
}

function boundedNonEmptyString(
  value: unknown,
  maxCharacters: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxCharacters
    ? normalized
    : undefined;
}

/** Strictly validates the versioned Remote MCP result contract. */
export function parseDatoScriptOutcomeV1(
  value: unknown,
): DatoScriptOutcomeV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value)) return undefined;
  if (
    value.version !== 1 ||
    value.kind !== 'dato_script_outcome' ||
    value.status !== 'failed' ||
    typeof value.failureCode !== 'string' ||
    !FAILURE_CODES.has(value.failureCode as DatoScriptFailureCode) ||
    typeof value.executionState !== 'string' ||
    !EXECUTION_STATES.has(value.executionState as DatoScriptExecutionState) ||
    typeof value.projectChangeState !== 'string' ||
    !PROJECT_CHANGE_STATES.has(
      value.projectChangeState as DatoScriptProjectChangeState,
    ) ||
    (value.recovery !== 'fix_and_review' && value.recovery !== 'none')
  ) {
    return undefined;
  }

  const scriptName = boundedNonEmptyString(
    value.scriptName,
    MAX_DATO_SCRIPT_NAME_CHARACTERS,
  );
  const rawMessage = boundedNonEmptyString(
    value.message,
    MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS,
  );
  if (!scriptName?.startsWith('script://dato-agent/') || !rawMessage) {
    return undefined;
  }
  const message = rawMessage
    .replace(BEARER_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_KEY_PATTERN, '[redacted]');

  return {
    version: 1,
    kind: 'dato_script_outcome',
    status: 'failed',
    failureCode: value.failureCode as DatoScriptFailureCode,
    executionState: value.executionState as DatoScriptExecutionState,
    projectChangeState:
      value.projectChangeState as DatoScriptProjectChangeState,
    recovery: value.recovery,
    scriptName,
    message,
  };
}

function parseMarker(text: string): DatoScriptOutcomeV1 | undefined {
  if (!text.startsWith(DATO_SCRIPT_OUTCOME_MARKER_PREFIX)) return undefined;
  const markerEnd = text.indexOf('\n');
  if (
    markerEnd < DATO_SCRIPT_OUTCOME_MARKER_PREFIX.length ||
    markerEnd > MAX_DATO_SCRIPT_OUTCOME_MARKER_CHARACTERS
  ) {
    return undefined;
  }

  const payload = text.slice(
    DATO_SCRIPT_OUTCOME_MARKER_PREFIX.length,
    markerEnd,
  );
  try {
    return parseDatoScriptOutcomeV1(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

export function stripDatoScriptOutcomeMarker(text: string): string {
  if (!text.startsWith(DATO_SCRIPT_OUTCOME_MARKER_PREFIX)) return text;
  const markerEnd = text.indexOf('\n');
  return markerEnd >= DATO_SCRIPT_OUTCOME_MARKER_PREFIX.length &&
    markerEnd <= MAX_DATO_SCRIPT_OUTCOME_MARKER_CHARACTERS
    ? text.slice(markerEnd + 1)
    : text;
}

export function boundedDatoScriptDiagnostic(text: string): string {
  const redacted = stripDatoScriptOutcomeMarker(text)
    .replace(BEARER_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_KEY_PATTERN, '[redacted]')
    .trim();
  if (!redacted) return 'DatoCMS returned no diagnostic details.';
  if (redacted.length <= MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS) {
    return redacted;
  }
  const suffix = '\n… [truncated]';
  return `${redacted.slice(
    0,
    MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS - suffix.length,
  )}${suffix}`;
}

function legacyOutcome(
  text: string,
  scriptName: string | undefined,
): DatoScriptOutcomeV1 | undefined {
  if (!scriptName?.startsWith('script://dato-agent/')) return undefined;

  const definitions: ReadonlyArray<{
    headings: readonly string[];
    failureCode: DatoScriptFailureCode;
    executionState: DatoScriptExecutionState;
    projectChangeState: DatoScriptProjectChangeState;
    recovery: DatoScriptOutcomeV1['recovery'];
  }> = [
    {
      headings: [
        '# Script saved with validation errors',
        'Script validation failed.',
        '# Script validation failed.',
      ],
      failureCode: 'script_validation',
      executionState: 'not_started',
      projectChangeState: 'none',
      recovery: 'fix_and_review',
    },
    {
      headings: [
        '# Script saved, but client calls are unverified',
        'Method-token verification failed.',
        '# Method-token verification failed.',
      ],
      failureCode: 'method_verification',
      executionState: 'not_started',
      projectChangeState: 'none',
      recovery: 'fix_and_review',
    },
    {
      headings: [
        '# Script saved, but compilation failed',
        'TypeScript compilation failed.',
        '# TypeScript compilation failed.',
      ],
      failureCode: 'typescript_compilation',
      executionState: 'not_started',
      projectChangeState: 'none',
      recovery: 'fix_and_review',
    },
  ];

  const definition = definitions.find(({ headings }) =>
    headings.some(
      (heading) =>
        text === heading ||
        text.startsWith(`${heading}\n`) ||
        text.startsWith(`${heading}\r\n`),
    ),
  );
  if (!definition) return undefined;

  return {
    version: 1,
    kind: 'dato_script_outcome',
    status: 'failed',
    failureCode: definition.failureCode,
    executionState: definition.executionState,
    projectChangeState: definition.projectChangeState,
    recovery: definition.recovery,
    scriptName,
    message: boundedDatoScriptDiagnostic(text),
  };
}

function structuredOutcome(structuredContent: unknown): {
  present: boolean;
  outcome?: DatoScriptOutcomeV1;
} {
  if (
    !isRecord(structuredContent) ||
    !Object.hasOwn(structuredContent, 'datoScriptOutcome')
  ) {
    return { present: false };
  }
  return {
    present: true,
    outcome: parseDatoScriptOutcomeV1(structuredContent.datoScriptOutcome),
  };
}

/**
 * Extracts only the explicit Remote MCP contract or exact byte-zero rolling
 * compatibility headings. Arbitrary nested output and prose are never parsed.
 */
export function extractDatoScriptOutcome(input: {
  text: string;
  structuredContent?: unknown;
  legacyScriptName?: string;
}): ExtractedDatoScriptOutcome {
  const diagnostic = boundedDatoScriptDiagnostic(input.text);
  const structured = structuredOutcome(input.structuredContent);
  const markerPresent = input.text.startsWith(
    DATO_SCRIPT_OUTCOME_MARKER_PREFIX,
  );
  const markerOutcome = markerPresent ? parseMarker(input.text) : undefined;
  if (structured.present) {
    if (
      markerPresent &&
      (!structured.outcome ||
        !markerOutcome ||
        JSON.stringify(structured.outcome) !== JSON.stringify(markerOutcome))
    ) {
      return { diagnostic, contractPresent: true };
    }
    return {
      ...(structured.outcome ? { outcome: structured.outcome } : {}),
      diagnostic,
      contractPresent: true,
    };
  }

  if (markerOutcome) {
    return { outcome: markerOutcome, diagnostic, contractPresent: true };
  }
  if (markerPresent) {
    return { diagnostic, contractPresent: true };
  }

  const rollingOutcome = legacyOutcome(input.text, input.legacyScriptName);
  return {
    ...(rollingOutcome ? { outcome: rollingOutcome } : {}),
    diagnostic,
    contractPresent: Boolean(rollingOutcome),
  };
}
