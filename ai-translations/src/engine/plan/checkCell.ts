/**
 * Runs the value-level invariants for one reconstructed cell against its
 * {@link CellPlan} contract, returning the QC flags `conform` then buckets (spec
 * §5). Pure and composition-only — it delegates to the existing checks; the
 * orchestration layer calls this per cell after reconstruct, and runs
 * `checkLocalePreservation` separately on the assembled field payload.
 *
 * Scope: the invariants fully determined by (expected + reconstructed value +
 * source value + finishReason). Segment/placeholder/structure-vs-source text
 * checks are emitted earlier in the translate path (they need per-segment token
 * context) and flow through the same flag channel.
 */
import { checkTruncated } from '../../utils/translation/qc/checks';
import { checkFieldLength } from '../../utils/translation/qc/validatorChecks';
import type { QcFlag } from '../../utils/translation/qc/types';
import { checkCannotBeBlank } from './checks/cannotBeBlank';
import { checkBlockStructure } from './checks/blockStructure';
import { checkBlockIdProvenance } from './checks/blockIdProvenance';
import type { CellPlan } from './types';

export function checkReconstructedCell(args: {
  cell: CellPlan;
  translatedValue: unknown;
  sourceValue?: unknown;
  finishReason?: string;
}): QcFlag[] {
  const { cell, translatedValue, sourceValue, finishReason } = args;
  const { fieldPath, toLocale: locale, expected } = cell;
  const flags: QcFlag[] = [];
  const push = (flag: QcFlag | null): void => {
    if (flag) flags.push(flag);
  };

  push(checkTruncated({ finishReason, fieldPath, locale }));
  push(
    checkCannotBeBlank({
      value: translatedValue,
      cannotBeBlank: cell.cannotBeBlank,
      fieldPath,
      locale,
    }),
  );
  push(
    checkFieldLength({
      value: translatedValue,
      validators: expected.lengthBounds
        ? ({ length: expected.lengthBounds } as never)
        : undefined,
      fieldPath,
      locale,
    }),
  );
  if (expected.blockSignature) {
    push(
      checkBlockStructure({
        value: translatedValue,
        expected: expected.blockSignature,
        fieldPath,
        locale,
      }),
    );
  }
  if (sourceValue !== undefined) {
    push(checkBlockIdProvenance({ sourceValue, targetValue: translatedValue, fieldPath, locale }));
  }

  return flags;
}
