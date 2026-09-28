import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindReplaceSnapshot, PublishOffer } from './contract';
import {
  acmeRecords,
  eventsOf,
  type FixtureRecord,
  httpError,
  recordByKey,
  replaceAll,
  searchFor,
  settle,
  setupController,
} from './findReplace.fixtures';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

type Status = NonNullable<FixtureRecord['status']>;

/**
 * The "acme" records with publication statuses. a3 is a never-published
 * Article draft. Pages have no drafts, so writing them is already live.
 */
function records(statuses: Record<string, Status>): FixtureRecord[] {
  const draft: FixtureRecord = {
    id: 'a3',
    modelId: 'article',
    attributes: { title: 'Acme draft', slug: 'draft', body: 'Nothing yet' },
  };
  return [...acmeRecords(), draft].map((record) => ({
    ...record,
    status: statuses[record.id] ?? record.status,
  }));
}

const MIXED: Record<string, Status> = {
  a1: 'published',
  a2: 'updated',
  a3: 'draft',
};

async function replaced(
  options: Parameters<typeof setupController>[0] = {},
): Promise<ReturnType<typeof setupController>> {
  const harness = setupController({
    records: records(MIXED),
    canPublishModel: () => true,
    ...options,
  });
  await searchFor(harness, 'acme');
  harness.controller.setReplacementText('Globex');
  await replaceAll(harness);
  return harness;
}

function offerOf(snapshot: FindReplaceSnapshot): PublishOffer | null {
  return snapshot.primary.kind === 'searchAgain'
    ? snapshot.primary.publish
    : null;
}

async function publishAll(
  harness: ReturnType<typeof setupController>,
): Promise<boolean> {
  const offer = offerOf(harness.snapshot());
  if (!offer) throw new Error('Expected a publish offer');
  const started = harness.controller.publish(offer.token);
  await settle();
  return started;
}

describe('publishing after a run', () => {
  it('offers only records whose one unpublished change is the replacement', async () => {
    const harness = await replaced();
    const done = harness.snapshot();

    expect(done.run.phase).toBe('finished');
    // a1 was published; a2 had other changes and a3 was never published;
    // pages have no drafts (already live).
    expect(offerOf(done)).toEqual({
      token: expect.any(String),
      recordCount: 1,
      heldCount: 2,
    });
    expect(recordByKey(done, 'article:a1').publish).toEqual({ kind: 'ready' });
    // Held records are explained only once publishing happened.
    expect(recordByKey(done, 'article:a2').publish).toEqual({ kind: 'none' });
    expect(recordByKey(done, 'page:p1').publish).toEqual({ kind: 'none' });
    expect(harness.cma.publish).not.toHaveBeenCalled();
  });

  it('publishes after checking the version, then reports every record', async () => {
    const harness = await replaced();

    expect(await publishAll(harness)).toBe(true);

    expect(harness.cma.find).toHaveBeenCalledTimes(1);
    expect(harness.cma.find).toHaveBeenCalledWith('a1', { version: 'current' });
    expect(harness.cma.publish.mock.calls).toEqual([['a1']]);
    expect(harness.cma.records.get('a1')?.meta.status).toBe('published');
    expect(harness.cma.records.get('a2')?.meta.status).toBe('updated');

    const done = harness.snapshot();
    expect(recordByKey(done, 'article:a1').publish).toEqual({
      kind: 'published',
    });
    expect(recordByKey(done, 'article:a2').publish).toEqual({
      kind: 'held',
      reason: 'other_changes',
    });
    expect(recordByKey(done, 'article:a3').publish).toEqual({
      kind: 'held',
      reason: 'never_published',
    });
    expect(done.publish.phase).toBe('done');
    expect(offerOf(done)).toBeNull();
    expect(done.meta).toMatchObject({
      kind: 'runFinished',
      publishedRecords: 1,
    });
    expect(eventsOf(harness, 'publishEnded')).toEqual([
      {
        type: 'publishEnded',
        stopped: false,
        pass: {
          published: 1,
          skipped: 0,
          failed: 0,
          retryableFailed: 0,
          notAttempted: 0,
          planned: 1,
        },
        allFailedCause: null,
      },
    ]);
  });

  it('never offers publishing when the role cannot publish the model', async () => {
    const denied = await replaced({ canPublishModel: () => false });
    expect(offerOf(denied.snapshot())).toBeNull();

    const byDefault = await replaced({ canPublishModel: undefined });
    expect(offerOf(byDefault.snapshot())).toBeNull();
  });

  it('leaves a record edited after the replacement unpublished', async () => {
    const harness = await replaced();
    harness.cma.edit('a1', { title: 'Edited by someone else' });

    await publishAll(harness);

    expect(harness.cma.publish).not.toHaveBeenCalled();
    expect(recordByKey(harness.snapshot(), 'article:a1').publish).toEqual({
      kind: 'skipped',
      reason: 'changed',
    });
    expect(eventsOf(harness, 'publishEnded')[0]?.pass.skipped).toBe(1);
  });

  it('offers a retryable failure again, but not a validation failure', async () => {
    const harness = await replaced({
      records: records({ ...MIXED, a2: 'published' }),
    });
    harness.cma.failPublishes('a1', [httpError(503)]);
    harness.cma.failPublishes('a2', [
      httpError(422, [{ code: 'INVALID_FIELD' }]),
    ]);

    await publishAll(harness);

    const afterFirst = harness.snapshot();
    expect(recordByKey(afterFirst, 'article:a1').publish).toMatchObject({
      kind: 'failed',
      reason: 'network',
      retryable: true,
    });
    expect(recordByKey(afterFirst, 'article:a2').publish).toMatchObject({
      kind: 'failed',
      reason: 'validation',
      retryable: false,
    });
    expect(offerOf(afterFirst)).toMatchObject({ recordCount: 1 });

    await publishAll(harness);

    expect(recordByKey(harness.snapshot(), 'article:a1').publish).toEqual({
      kind: 'published',
    });
    expect(offerOf(harness.snapshot())).toBeNull();
  });

  it('locks the page while publishing, guards the tab, and stops after the record in flight', async () => {
    const harness = await replaced({
      records: records({ ...MIXED, a2: 'published' }),
    });
    const original = harness.cma.publish.getMockImplementation();
    harness.cma.publish.mockImplementation(async (id: string) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return original?.(id);
    });
    const frames: FindReplaceSnapshot[] = [];
    harness.controller.subscribe(() => frames.push(harness.snapshot()));

    const offer = offerOf(harness.snapshot());
    if (!offer) throw new Error('Expected a publish offer');
    expect(harness.controller.publish(offer.token)).toBe(true);
    // A second click with the same (now stale) token does nothing.
    expect(harness.controller.publish(offer.token)).toBe(false);

    const running = harness.snapshot();
    expect(running.primary).toEqual({ kind: 'publishing', count: 2 });
    expect(running.findRow.enabled).toBe(false);
    expect(running.modelFilter.enabled).toBe(false);
    expect(harness.unload.addEventListener).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function),
    );
    harness.controller.setPattern('something else');
    expect(harness.snapshot().find.pattern).toBe('acme');

    harness.controller.stopPublish();
    expect(harness.snapshot().publish.phase).toBe('stopping');
    await settle();

    expect(harness.cma.publish.mock.calls).toEqual([['a1']]);
    expect(eventsOf(harness, 'publishEnded')[0]).toMatchObject({
      stopped: true,
      pass: { published: 1, notAttempted: 1, planned: 2 },
    });
    expect(harness.unload.removeEventListener).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function),
    );
    // What wasn't attempted is offered again.
    expect(offerOf(harness.snapshot())).toMatchObject({ recordCount: 1 });
    expect(
      frames.some(
        (frame) =>
          recordByKey(frame, 'article:a1').publish.kind === 'publishing',
      ),
    ).toBe(true);
  });

  it('a new search ends the publish session', async () => {
    const harness = await replaced();
    await publishAll(harness);

    await searchFor(harness, 'globex');

    const snapshot = harness.snapshot();
    expect(snapshot.publish.phase).toBe('none');
    expect(snapshot.primary.kind).toBe('replace');
    for (const record of snapshot.records) {
      expect(record.publish).toEqual({ kind: 'none' });
    }
  });
});
