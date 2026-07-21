/**
 * Shared resume-detection prompt for the two bulk-translation openers (the
 * custom page and the records-dropdown action). Reads the latest persisted run,
 * and if a compatible one was interrupted, asks the user whether to resume its
 * unfinished units or start over (persistence spec §8, steps 4–5).
 *
 * Kept out of the openers so the branching (proceed / proceed-with-resume /
 * cancel / delete-and-start-over) is unit-tested. The prompt is raised from the
 * opener's top-level handler — never from inside a renderModal — so it does not
 * nest modals.
 */
import {
  createIndexedDBRunStore,
  decideResume,
  policyDigest,
  type ResumeTarget,
  type RunStore,
} from '../engine/report';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';

/** The subset of a DatoCMS ctx this helper needs (any opener ctx satisfies it). */
type ConfirmCtx = {
  openConfirm: (options: {
    title: string;
    content: string;
    choices: {
      label: string;
      value: string;
      intent?: 'positive' | 'negative';
    }[];
    cancel: { label: string; value: string };
  }) => Promise<unknown>;
};

export type ResumeSelection =
  | { kind: 'cancel' }
  | { kind: 'proceed'; resume?: { runId: string; targets: ResumeTarget[] } };

/**
 * @param ctx - Opener ctx (needs `openConfirm`).
 * @param pluginParams - Live plugin config, for the policy-compatibility check.
 * @param store - RunStore; defaults to the IndexedDB tier. Injected in tests.
 * @returns `cancel` if the user backed out; otherwise `proceed`, carrying the
 *   resume input when the user chose to resume.
 */
export const resolveResumeSelection = async (
  ctx: ConfirmCtx,
  pluginParams: ctxParamsType,
  store: RunStore = createIndexedDBRunStore(),
): Promise<ResumeSelection> => {
  const prior = await store.latest().catch(() => null);
  const decision = decideResume(
    prior,
    policyDigest({
      excludedTokens: pluginParams.apiKeysToBeExcludedFromThisPlugin ?? [],
      copyTokens: pluginParams.fieldsToCopyFromSource ?? [],
    }),
  );
  if (decision.kind !== 'resumable') return { kind: 'proceed' };

  const choice = await ctx.openConfirm({
    title: 'Resume the previous run?',
    content: `A previous bulk translation left ${decision.targets.length} record–locale unit(s) unfinished. Resume where it left off, or start over?`,
    choices: [
      { label: 'Resume', value: 'resume', intent: 'positive' },
      { label: 'Start over', value: 'fresh' },
    ],
    cancel: { label: 'Cancel', value: 'cancel' },
  });

  if (choice === 'cancel') return { kind: 'cancel' };
  if (choice === 'resume') {
    return {
      kind: 'proceed',
      resume: {
        runId: decision.priorState.runId,
        targets: decision.targets,
      },
    };
  }
  // Start over: drop the stale checkpoint so it isn't offered again.
  await store.delete(decision.priorState.runId).catch(() => {});
  return { kind: 'proceed' };
};
