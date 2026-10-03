import { hasPersistedUpdates } from './BulkPublishUtils';
import type { ProgressUpdate } from './ItemsDropdownUtils';

export const VISIBLE_TRANSLATION_UPDATE_LIMIT = 100;
/** Keep the existing complete modal result for ordinary runs. */
export const FULL_TRANSLATION_HISTORY_LIMIT = 5_000;

export type TranslationProgressSummary = {
  totalRecords: number;
  processedCount: number;
  successfulCount: number;
  failedCount: number;
  warningCount: number;
  loadedCount: number;
  updatedCount: number;
};

export type TranslationProgressSnapshot = TranslationProgressSummary & {
  updates: ProgressUpdate[];
  updateCount: number;
  publishableCount: number;
  historyTruncated: boolean;
};

const COMPLETED = 1;
const FAILED = 2;
const WARNED = 4;
const SEEN = 8;
const UPDATED = 16;

function stateForUpdate(update: ProgressUpdate): number {
  let state = SEEN;
  if (update.status === 'completed') {
    state |= COMPLETED;
    if ((update.warnings?.length ?? 0) > 0) state |= WARNED;
    if (hasPersistedUpdates(update)) state |= UPDATED;
  }
  if (update.status === 'error') state |= FAILED;
  return state;
}

/**
 * Mutable run bookkeeping, separate from React renders and record payloads.
 * A byte per selected ID keeps duplicate events accurate without retaining
 * every label, field list and warning. Only recent rows retain those details
 * once a run exceeds the ordinary-history limit.
 */
export class TranslationProgressStore {
  private readonly recordIndexes = new Map<string, number>();
  private readonly recordStates: Uint8Array;
  private readonly noticeIds = new Set<string>();
  private readonly recentUpdates = new Map<string, ProgressUpdate>();
  private fullHistory: Map<string, ProgressUpdate> | null = new Map();
  private readonly draftModeItemTypeIds = new Set<string>();
  private readonly knownItemTypeIds = new Set<string>();
  private readonly pendingPublicationIds = new Map<string, Set<string>>();
  private readonly pendingPublicationModels = new Map<string, string>();
  private readonly pendingRecordVersions = new Map<string, string>();
  private readonly publishableRecordIds = new Set<string>();
  private readonly expectedRecordVersions = new Map<string, string>();
  private successfulCount = 0;
  private failedCount = 0;
  private warningCount = 0;
  private loadedCount = 0;
  private updatedCount = 0;
  private updateCount = 0;

  constructor(itemIds: Iterable<string>) {
    for (const id of itemIds) {
      if (id && !this.recordIndexes.has(id)) {
        this.recordIndexes.set(id, this.recordIndexes.size);
      }
    }
    this.recordStates = new Uint8Array(this.recordIndexes.size);
    if (this.recordIndexes.size > FULL_TRANSLATION_HISTORY_LIMIT) {
      this.fullHistory = null;
    }
  }

  getRecordIndex(recordId: string): number {
    return this.recordIndexes.get(recordId) ?? -1;
  }

  /** Register a batch's model eligibility before processing its records. */
  addDraftModeItemTypeIds(itemTypeIds: Iterable<string>): void {
    const ids = [...itemTypeIds];
    this.registerModelPublishingEligibility(ids, ids);
  }

  registerModelPublishingEligibility(
    itemTypeIds: Iterable<string>,
    draftModeItemTypeIds: Iterable<string>,
  ): void {
    const draftIds = new Set(draftModeItemTypeIds);
    for (const modelId of itemTypeIds) {
      this.knownItemTypeIds.add(modelId);
      if (draftIds.has(modelId)) this.draftModeItemTypeIds.add(modelId);
      this.resolvePublicationCandidates(modelId, draftIds.has(modelId));
    }
  }

  private resolvePublicationCandidates(
    modelId: string,
    canPublish: boolean,
  ): void {
    const pendingIds = this.pendingPublicationIds.get(modelId);
    if (!pendingIds) return;
    for (const recordId of pendingIds) {
      if (canPublish) {
        this.publishableRecordIds.add(recordId);
        const version = this.pendingRecordVersions.get(recordId);
        if (version) this.expectedRecordVersions.set(recordId, version);
      }
      this.pendingPublicationModels.delete(recordId);
      this.pendingRecordVersions.delete(recordId);
    }
    this.pendingPublicationIds.delete(modelId);
  }

  setLoadedCount(count: number): void {
    this.loadedCount = count;
  }

  add(update: ProgressUpdate): void {
    const index = this.recordIndexes.get(update.recordId);
    if (index !== undefined && update.recordIndex >= 0) {
      if (!this.updateRecordState(index, update)) return;
      this.updatePublicationEligibility(update);
    } else if (!this.noticeIds.has(update.recordId)) {
      // Fatal notices are shown, but are not an additional failed record.
      this.noticeIds.add(update.recordId);
      this.updateCount += 1;
    }

    this.updateHistory(update);
  }

  private updateRecordState(index: number, update: ProgressUpdate): boolean {
    const previous = this.recordStates[index];
    const next = stateForUpdate(update);
    // A delayed in-progress event must not undo a confirmed terminal result.
    if (
      (previous & (COMPLETED | FAILED)) !== 0 &&
      (next & (COMPLETED | FAILED)) === 0
    ) {
      return false;
    }
    this.successfulCount +=
      Number((next & COMPLETED) !== 0) - Number((previous & COMPLETED) !== 0);
    this.failedCount +=
      Number((next & FAILED) !== 0) - Number((previous & FAILED) !== 0);
    this.warningCount +=
      Number((next & WARNED) !== 0) - Number((previous & WARNED) !== 0);
    this.updatedCount +=
      Number((next & UPDATED) !== 0) - Number((previous & UPDATED) !== 0);
    if ((previous & SEEN) === 0) this.updateCount += 1;
    this.recordStates[index] = next;
    return true;
  }

  private updatePublicationEligibility(update: ProgressUpdate): void {
    const previousModelId = this.pendingPublicationModels.get(update.recordId);
    if (previousModelId !== undefined) {
      this.pendingPublicationIds.get(previousModelId)?.delete(update.recordId);
      this.pendingPublicationModels.delete(update.recordId);
      this.pendingRecordVersions.delete(update.recordId);
    }
    this.publishableRecordIds.delete(update.recordId);
    this.expectedRecordVersions.delete(update.recordId);
    if (
      update.status !== 'completed' ||
      !update.itemTypeId ||
      !hasPersistedUpdates(update)
    ) {
      return;
    }
    if (this.draftModeItemTypeIds.has(update.itemTypeId)) {
      this.publishableRecordIds.add(update.recordId);
    } else if (!this.knownItemTypeIds.has(update.itemTypeId)) {
      // A failed optional model lookup can recover in a later batch. Preserve
      // only the candidate ID so earlier updates do not become unpublishable.
      let pendingIds = this.pendingPublicationIds.get(update.itemTypeId);
      if (!pendingIds) {
        pendingIds = new Set();
        this.pendingPublicationIds.set(update.itemTypeId, pendingIds);
      }
      pendingIds.add(update.recordId);
      this.pendingPublicationModels.set(update.recordId, update.itemTypeId);
    }
    this.recordExpectedVersion(update);
  }

  private recordExpectedVersion(update: ProgressUpdate): void {
    if (!update.currentVersion) return;
    if (this.publishableRecordIds.has(update.recordId)) {
      this.expectedRecordVersions.set(update.recordId, update.currentVersion);
    } else if (this.pendingPublicationModels.has(update.recordId)) {
      this.pendingRecordVersions.set(update.recordId, update.currentVersion);
    }
  }

  private updateHistory(update: ProgressUpdate): void {
    this.recentUpdates.delete(update.recordId);
    this.recentUpdates.set(update.recordId, update);
    if (this.recentUpdates.size > VISIBLE_TRANSLATION_UPDATE_LIMIT) {
      const oldestId = this.recentUpdates.keys().next().value;
      if (oldestId !== undefined) this.recentUpdates.delete(oldestId);
    }

    if (this.fullHistory) {
      this.fullHistory.delete(update.recordId);
      this.fullHistory.set(update.recordId, update);
      if (this.fullHistory.size > FULL_TRANSLATION_HISTORY_LIMIT) {
        this.fullHistory = null;
      }
    }
  }

  getSummary(): TranslationProgressSummary {
    return {
      totalRecords: this.recordIndexes.size,
      processedCount: this.successfulCount + this.failedCount,
      successfulCount: this.successfulCount,
      failedCount: this.failedCount,
      warningCount: this.warningCount,
      loadedCount: this.loadedCount,
      updatedCount: this.updatedCount,
    };
  }

  snapshot(): TranslationProgressSnapshot {
    return {
      ...this.getSummary(),
      updates: [...this.recentUpdates.values()],
      updateCount: this.updateCount,
      publishableCount: this.publishableRecordIds.size,
      historyTruncated: this.fullHistory === null,
    };
  }

  /** Materialize the ID list only when the user requests publication. */
  getPublishableRecordIds(): string[] {
    return [...this.publishableRecordIds];
  }

  getPublishableRecordVersions(): ReadonlyMap<string, string> {
    return this.expectedRecordVersions;
  }

  getResultUpdates(): ProgressUpdate[] {
    return [...(this.fullHistory ?? this.recentUpdates).values()];
  }
}
