import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryRunStore,
  createRunState,
  foldOutcome,
  policyDigest,
  type RunState,
} from '../engine/report';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { detectResumableRun, resolveResumeSelection } from './resumePrompt';

const pluginParams = {
  apiKeysToBeExcludedFromThisPlugin: [],
  fieldsToCopyFromSource: [],
} as unknown as ctxParamsType;

const digest = policyDigest({ excludedTokens: [], copyTokens: [] });

const priorWithUnfinished = (): RunState => {
  let s = createRunState({
    runId: 'run-1',
    deviceId: 'd',
    startedAt: 1,
    operation: 'translate',
    policyDigest: digest,
    fromLocale: 'en',
    toLocales: ['it'],
  });
  s = foldOutcome(
    s,
    { recordId: 'r1', toLocale: 'it', bucket: 'blocked', reasons: [], flags: [] },
    { now: 1 },
  );
  return s;
};

const ctxWith = (confirmValue: unknown) => ({
  openConfirm: vi.fn().mockResolvedValue(confirmValue),
});

describe('resolveResumeSelection', () => {
  it('proceeds without resume (and never prompts) when there is no prior run', async () => {
    const store = createInMemoryRunStore();
    const ctx = ctxWith('resume');
    const sel = await resolveResumeSelection(ctx, pluginParams, store);
    expect(sel).toEqual({ kind: 'proceed' });
    expect(ctx.openConfirm).not.toHaveBeenCalled();
  });

  it('returns the resume input when the user chooses Resume', async () => {
    const store = createInMemoryRunStore();
    await store.save(priorWithUnfinished());
    const sel = await resolveResumeSelection(
      ctxWith('resume'),
      pluginParams,
      store,
    );
    expect(sel).toEqual({
      kind: 'proceed',
      resume: { runId: 'run-1', targets: [{ recordId: 'r1', toLocale: 'it' }] },
    });
  });

  it('deletes the prior run and proceeds fresh when the user chooses Start over', async () => {
    const store = createInMemoryRunStore();
    await store.save(priorWithUnfinished());
    const sel = await resolveResumeSelection(
      ctxWith('fresh'),
      pluginParams,
      store,
    );
    expect(sel).toEqual({ kind: 'proceed' });
    expect(await store.load('run-1')).toBeNull();
  });

  it('returns cancel when the user cancels the prompt', async () => {
    const store = createInMemoryRunStore();
    await store.save(priorWithUnfinished());
    const sel = await resolveResumeSelection(
      ctxWith('cancel'),
      pluginParams,
      store,
    );
    expect(sel).toEqual({ kind: 'cancel' });
  });
});

describe('detectResumableRun', () => {
  it('returns the resumable run without prompting when one is compatible', async () => {
    const store = createInMemoryRunStore();
    await store.save(priorWithUnfinished());
    const found = await detectResumableRun(pluginParams, store);
    expect(found?.runId).toBe('run-1');
    expect(found?.targets.length).toBeGreaterThan(0);
    expect(found?.priorState.records).toHaveLength(1);
  });

  it('returns null when there is no prior run', async () => {
    const store = createInMemoryRunStore();
    expect(await detectResumableRun(pluginParams, store)).toBeNull();
  });
});
