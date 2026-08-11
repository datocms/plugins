import { describe, expect, it } from 'vitest';
import {
  boundedDatoScriptDiagnostic,
  DATO_SCRIPT_OUTCOME_MARKER_PREFIX,
  type DatoScriptOutcomeV1,
  extractDatoScriptOutcome,
  MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS,
  MAX_DATO_SCRIPT_NAME_CHARACTERS,
  MAX_DATO_SCRIPT_OUTCOME_MARKER_CHARACTERS,
  parseDatoScriptOutcomeV1,
  stripDatoScriptOutcomeMarker,
} from './datoScriptOutcome';

function outcome(
  overrides: Partial<DatoScriptOutcomeV1> = {},
): DatoScriptOutcomeV1 {
  return {
    version: 1,
    kind: 'dato_script_outcome',
    status: 'failed',
    failureCode: 'script_validation',
    executionState: 'not_started',
    projectChangeState: 'none',
    recovery: 'fix_and_review',
    scriptName: 'script://dato-agent/site/primary/update.ts',
    message: 'The TypeScript failed static validation.',
    ...overrides,
  };
}

function marked(
  value: unknown,
  diagnostic = 'Human-readable details.',
): string {
  return `${DATO_SCRIPT_OUTCOME_MARKER_PREFIX}${JSON.stringify(value)}\n${diagnostic}`;
}

describe('DatoScriptOutcomeV1', () => {
  it('strictly parses the versioned marker at byte zero and strips it', () => {
    const value = outcome();
    const text = marked(value);

    expect(parseDatoScriptOutcomeV1(value)).toEqual(value);
    expect(extractDatoScriptOutcome({ text })).toEqual({
      outcome: value,
      diagnostic: 'Human-readable details.',
      contractPresent: true,
    });
    expect(stripDatoScriptOutcomeMarker(text)).toBe('Human-readable details.');
  });

  it('accepts matching structured and marker contracts and rejects conflicts', () => {
    const structured = outcome({ failureCode: 'method_verification' });
    const matchingText = marked(structured);

    expect(
      extractDatoScriptOutcome({
        text: matchingText,
        structuredContent: {
          datoScriptOutcome: structured,
          text: matchingText,
        },
      }),
    ).toEqual({
      outcome: structured,
      diagnostic: 'Human-readable details.',
      contractPresent: true,
    });

    const conflictingText = marked(
      outcome({ failureCode: 'typescript_compilation' }),
    );
    expect(
      extractDatoScriptOutcome({
        text: conflictingText,
        structuredContent: {
          datoScriptOutcome: structured,
          text: conflictingText,
        },
      }),
    ).toEqual({
      diagnostic: 'Human-readable details.',
      contractPresent: true,
    });
    expect(
      extractDatoScriptOutcome({
        text: `${DATO_SCRIPT_OUTCOME_MARKER_PREFIX}{broken}\nDetails`,
        structuredContent: { datoScriptOutcome: structured },
      }),
    ).toEqual({ diagnostic: 'Details', contractPresent: true });
  });

  it('fails closed for malformed structured content and markers', () => {
    const validText = marked(outcome());
    expect(
      extractDatoScriptOutcome({
        text: validText,
        structuredContent: { datoScriptOutcome: { ...outcome(), version: 2 } },
      }),
    ).toEqual({
      diagnostic: 'Human-readable details.',
      contractPresent: true,
    });
    const malformed = extractDatoScriptOutcome({
      text: `${DATO_SCRIPT_OUTCOME_MARKER_PREFIX}{broken}\nDetails`,
    });
    expect(malformed.outcome).toBeUndefined();
    expect(malformed.contractPresent).toBe(true);
    expect(malformed.diagnostic).toBe('Details');
    const laterMarker = extractDatoScriptOutcome({
      text: `Prefix\n${marked(outcome())}`,
    });
    expect(laterMarker.outcome).toBeUndefined();
    expect(laterMarker.contractPresent).toBe(false);
  });

  it('rejects extra keys, invalid invariants, oversized values, and unsafe names', () => {
    expect(
      parseDatoScriptOutcomeV1({ ...outcome(), extra: true }),
    ).toBeUndefined();
    expect(
      parseDatoScriptOutcomeV1({
        ...outcome(),
        projectChangeState: 'definitely_none',
      }),
    ).toBeUndefined();
    expect(
      parseDatoScriptOutcomeV1({
        ...outcome(),
        scriptName: 'script://someone-else/update.ts',
      }),
    ).toBeUndefined();
    expect(
      parseDatoScriptOutcomeV1({
        ...outcome(),
        message: 'x'.repeat(MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS + 1),
      }),
    ).toBeUndefined();
    expect(
      parseDatoScriptOutcomeV1({
        ...outcome(),
        scriptName: `script://dato-agent/${'x'.repeat(
          MAX_DATO_SCRIPT_NAME_CHARACTERS,
        )}`,
      }),
    ).toBeUndefined();
  });

  it.each([
    [
      '# Script saved with validation errors',
      'script_validation',
      'fix_and_review',
    ],
    [
      '# Script saved, but client calls are unverified',
      'method_verification',
      'fix_and_review',
    ],
    [
      '# Script saved, but compilation failed',
      'typescript_compilation',
      'fix_and_review',
    ],
    ['Script validation failed.', 'script_validation', 'fix_and_review'],
    ['# Script validation failed.', 'script_validation', 'fix_and_review'],
    [
      'Method-token verification failed.',
      'method_verification',
      'fix_and_review',
    ],
    [
      '# Method-token verification failed.',
      'method_verification',
      'fix_and_review',
    ],
    [
      'TypeScript compilation failed.',
      'typescript_compilation',
      'fix_and_review',
    ],
    [
      '# TypeScript compilation failed.',
      'typescript_compilation',
      'fix_and_review',
    ],
  ])('recognizes exact legacy heading %s', (heading, failureCode, recovery) => {
    const parsed = extractDatoScriptOutcome({
      text: `${heading}\nMore details`,
      legacyScriptName: 'script://dato-agent/site/primary/update.ts',
    });
    expect(parsed.outcome).toMatchObject({ failureCode, recovery });
    expect(parsed.contractPresent).toBe(true);
  });

  it('does not loose-match legacy prose or nested headings', () => {
    for (const text of [
      ' Script validation failed.\nDetails',
      'Explanation\nScript validation failed.',
      'Script validation failed unexpectedly.\nDetails',
      '# Script saved with validation errors and warnings\nDetails',
      '# Script saved, but execution failed\nDetails',
      '# Script saved, but sandbox failed\nDetails',
      'Sandbox setup failed.\nDetails',
      'Project resolution failed.\nDetails',
    ]) {
      const parsed = extractDatoScriptOutcome({
        text,
        legacyScriptName: 'script://dato-agent/site/primary/update.ts',
      });
      expect(parsed.outcome).toBeUndefined();
      expect(parsed.contractPresent).toBe(false);
    }
  });

  it('accepts the largest escaped marker within the transport bound', () => {
    const escapedMessage = `${'\\"x\n'.repeat(999)}\\"x`;
    const text = marked(outcome({ message: escapedMessage }));
    expect(text.indexOf('\n')).toBeLessThanOrEqual(
      MAX_DATO_SCRIPT_OUTCOME_MARKER_CHARACTERS,
    );
    expect(extractDatoScriptOutcome({ text }).outcome).toMatchObject({
      failureCode: 'script_validation',
      message: escapedMessage,
    });
  });

  it('redacts and bounds diagnostics independently from the marker payload', () => {
    const diagnostic = boundedDatoScriptDiagnostic(
      `Bearer secret-token sk-abcdefghijklmnop ${'x'.repeat(5_000)}`,
    );
    expect(diagnostic).toContain('Bearer [redacted]');
    expect(diagnostic).toContain('[redacted]');
    expect(diagnostic).not.toContain('secret-token');
    expect(diagnostic.length).toBeLessThanOrEqual(
      MAX_DATO_SCRIPT_DIAGNOSTIC_CHARACTERS,
    );
  });
});
