import { describe, expect, it } from 'vitest';
import type { ProgressUpdate } from './ItemsDropdownUtils';
import {
  FULL_TRANSLATION_HISTORY_LIMIT,
  TranslationProgressStore,
  VISIBLE_TRANSLATION_UPDATE_LIMIT,
} from './TranslationProgressStore';

function completed(recordId: string, recordIndex: number): ProgressUpdate {
  return {
    recordId,
    recordIndex,
    status: 'completed',
    itemTypeId: 'article',
    recordLabel: `Article ${recordId}`,
    translatedFieldApiKeys: ['title'],
    currentVersion: `v-${recordId}`,
  };
}

describe('TranslationProgressStore', () => {
  it('tracks terminal states and warnings once per record, independently of notices or duplicate indexes', () => {
    const store = new TranslationProgressStore(['a', 'b', 'a']);
    store.addDraftModeItemTypeIds(['article']);
    store.setLoadedCount(2);
    store.add({ ...completed('a', 0), warnings: ['Copied references'] });
    store.add({ ...completed('a', 0), warnings: ['Copied references'] });
    store.add({ ...completed('b', 0), status: 'error' });
    store.add({ recordId: 'fatal', recordIndex: -1, status: 'error' });

    expect(store.getRecordIndex('b')).toBe(1);
    expect(store.getSummary()).toEqual({
      totalRecords: 2,
      processedCount: 2,
      successfulCount: 1,
      failedCount: 1,
      warningCount: 1,
      loadedCount: 2,
      updatedCount: 1,
    });
    expect(store.snapshot().updateCount).toBe(3);
    expect(store.getPublishableRecordIds()).toEqual(['a']);

    store.add(completed('b', 1));
    store.add(completed('a', 0));
    store.add({ ...completed('a', 0), status: 'processing' });

    expect(store.getSummary()).toMatchObject({
      processedCount: 2,
      successfulCount: 2,
      failedCount: 0,
      warningCount: 0,
    });
    expect(store.getResultUpdates()).toHaveLength(3);
    expect(store.getResultUpdates().at(-1)?.status).toBe('completed');
  });

  it('publishes only confirmed updates on models with draft mode', () => {
    const store = new TranslationProgressStore(['a', 'b', 'c', 'd', 'e']);
    store.addDraftModeItemTypeIds(['article']);
    store.add(completed('a', 0));
    store.add({ ...completed('b', 1), translatedFieldApiKeys: [] });
    store.add({ ...completed('c', 2), itemTypeId: 'block' });
    store.add({ ...completed('d', 3), status: 'error' });
    store.add({
      ...completed('e', 4),
      translatedFieldApiKeys: [],
      copiedLinkFieldIds: ['related'],
    });

    expect(store.getPublishableRecordIds()).toEqual(['a', 'e']);
    expect([...store.getPublishableRecordVersions()]).toEqual([
      ['a', 'v-a'],
      ['e', 'v-e'],
    ]);
    expect(store.getSummary().updatedCount).toBe(3);
    store.add({ ...completed('a', 0), status: 'error' });
    expect(store.getPublishableRecordIds()).toEqual(['e']);
  });

  it('reconciles compact candidates after an optional model lookup recovers', () => {
    const store = new TranslationProgressStore(['a', 'b', 'c']);
    store.add(completed('a', 0));
    store.add({ ...completed('b', 1), itemTypeId: 'regular' });
    store.add({ ...completed('c', 2), status: 'error' });
    expect(store.getPublishableRecordIds()).toEqual([]);

    store.registerModelPublishingEligibility(
      ['article', 'regular'],
      ['article'],
    );

    expect(store.getPublishableRecordIds()).toEqual(['a']);
  });

  it('preserves the complete detailed result of ordinary jobs while snapshots contain only recent rows', () => {
    const ids = Array.from(
      { length: FULL_TRANSLATION_HISTORY_LIMIT },
      (_, index) => `r${index}`,
    );
    const store = new TranslationProgressStore(ids);
    for (const [index, id] of ids.entries()) store.add(completed(id, index));

    expect(store.getResultUpdates()).toHaveLength(
      FULL_TRANSLATION_HISTORY_LIMIT,
    );
    expect(store.snapshot().updates).toHaveLength(
      VISIBLE_TRANSLATION_UPDATE_LIMIT,
    );
    expect(store.snapshot().historyTruncated).toBe(false);
  });

  it('aggregates 200000 synthetic events with bounded details and preserves every eligible publish ID', () => {
    const ids = Array.from({ length: 200_000 }, (_, index) => `r${index}`);
    const store = new TranslationProgressStore(ids);
    store.addDraftModeItemTypeIds(['article']);
    for (const [index, id] of ids.entries()) {
      const update = completed(id, index);
      if (index % 1_000 === 0) update.status = 'error';
      else if (index % 100 === 0) update.warnings = ['Copied references'];
      store.add({ ...update, status: 'processing' });
      store.add(update);
    }
    store.setLoadedCount(ids.length);

    expect(store.getSummary()).toEqual({
      totalRecords: 200_000,
      processedCount: 200_000,
      successfulCount: 199_800,
      failedCount: 200,
      warningCount: 1_800,
      loadedCount: 200_000,
      updatedCount: 199_800,
    });
    expect(store.snapshot()).toMatchObject({
      updateCount: 200_000,
      publishableCount: 199_800,
      historyTruncated: true,
    });
    expect(store.snapshot().updates).toHaveLength(
      VISIBLE_TRANSLATION_UPDATE_LIMIT,
    );
    const details = store.getResultUpdates();
    expect(details).toHaveLength(VISIBLE_TRANSLATION_UPDATE_LIMIT);
    expect(details[0].recordId).toBe('r199900');
    expect(details.at(-1)?.recordId).toBe('r199999');
    const publishIds = store.getPublishableRecordIds();
    expect(publishIds).toHaveLength(199_800);
    expect(publishIds[0]).toBe('r1');
    expect(publishIds.at(-1)).toBe('r199999');
  });
});
