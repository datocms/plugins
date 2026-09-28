import type { PatternProblem, ReplacementCheck } from '../contract';
import type { Copy } from './copy';

type FormLinesProps = {
  copy: Copy;
  patternProblem?: PatternProblem | null;
  replacementCheck?: ReplacementCheck;
};

/**
 * Form-level lines at the top of the column (no box, no icon, no period):
 * a pattern or replacement error in danger ink, then warnings in warning ink.
 */
export function FormLines({
  copy,
  patternProblem = null,
  replacementCheck,
}: FormLinesProps) {
  const problem = replacementCheck?.problem ?? null;
  const warnings = replacementCheck?.warnings ?? [];

  return (
    <>
      {patternProblem && (
        <p className="dl-form-error">{copy.patternProblem(patternProblem)}</p>
      )}
      {problem && (
        <p className="dl-form-error">{copy.replacementProblem(problem)}</p>
      )}
      {warnings.map((warning) => {
        const text = copy.replacementWarning(warning);
        return (
          <p key={text} className="fr-form-warning">
            {text}
          </p>
        );
      })}
    </>
  );
}
