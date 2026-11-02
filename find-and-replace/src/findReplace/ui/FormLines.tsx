import Callout from 'datocms-react-ui/Callout';
import type {
  PatternProblem,
  ReplacementCheck,
  ReplacementWarning,
} from '../contract';
import type { Copy } from './copy';
import type { FieldProblemIds } from './FindBar';

/**
 * A warning's identity, never its text: a count in the text (slug changes)
 * then updates the callout in place. A warning or danger callout is an alert,
 * so a new element would be read out again on each change of the count.
 */
function warningKey(warning: ReplacementWarning): string {
  return warning.code === 'group_out_of_range'
    ? `${warning.code}:${warning.token}`
    : warning.code;
}

type FormLinesProps = {
  copy: Copy;
  patternProblem?: PatternProblem | null;
  /**
   * Changes with each invalid pattern: the callout mounts again, so its
   * alert is read again, also for the same text (an alert that stays only
   * speaks when its text changes).
   */
  patternAlertKey?: number;
  replacementCheck?: ReplacementCheck;
  /**
   * The ids of the problem texts: the Find or Replace with input points to
   * its own, so the problem is the field's description.
   */
  problemIds?: FieldProblemIds;
};

/**
 * What is wrong with the find form, above the results: a pattern or a
 * replacement that can't run is an error, then each warning about the
 * replacement, in the snapshot's order. The errors and warnings are alerts:
 * a screen reader hears each one as it appears, so the page's live region
 * doesn't announce them again.
 */
export function FormLines({
  copy,
  patternProblem = null,
  patternAlertKey = 0,
  replacementCheck,
  problemIds,
}: FormLinesProps) {
  const problem = replacementCheck?.problem ?? null;
  const warnings = replacementCheck?.warnings ?? [];

  return (
    <>
      {patternProblem && (
        <Callout key={`pattern-${patternAlertKey}`} tone="danger">
          <span id={problemIds?.pattern}>
            {copy.patternProblem(patternProblem)}
          </span>
        </Callout>
      )}
      {problem && (
        <Callout tone="danger">
          <span id={problemIds?.replacement}>
            {copy.replacementProblem(problem)}
          </span>
        </Callout>
      )}
      {warnings.map((warning) => (
        <Callout
          key={warningKey(warning)}
          // A replacement that still contains the search is no risk to the
          // data: only information.
          tone={warning.code === 'self_match' ? 'neutral' : 'warning'}
        >
          {copy.replacementWarning(warning)}
        </Callout>
      ))}
    </>
  );
}
