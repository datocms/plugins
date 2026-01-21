import { useState, useMemo, useCallback } from 'react';
import type { CommentType } from '@ctypes/comments';
import type { StoredCommentSegment } from '@ctypes/mentions';

// Filter state types
export type CommentFilters = {
  searchQuery: string;
  authorId: string | null;
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  mentionedRecordId: string | null;
  mentionedAssetId: string | null;
  mentionedModelId: string | null;
  mentionedUserId: string | null;
};

// Option types for dropdowns
export type AuthorOption = {
  id: string;
  name: string;
};

export type RecordOption = {
  id: string;
  title: string;
  modelName: string;
};

export type AssetOption = {
  id: string;
  filename: string;
};

export type ModelOption = {
  id: string;
  name: string;
};

export type UserOption = {
  id: string;
  name: string;
};

export type FilterOptions = {
  authors: AuthorOption[];
  mentionedRecords: RecordOption[];
  mentionedAssets: AssetOption[];
  mentionedModels: ModelOption[];
  mentionedUsers: UserOption[];
};

const initialFilters: CommentFilters = {
  searchQuery: '',
  authorId: null,
  dateRange: { start: null, end: null },
  mentionedRecordId: null,
  mentionedAssetId: null,
  mentionedModelId: null,
  mentionedUserId: null,
};

type IndexedComment = {
  comment: CommentType;
  dateTimestamp: number;
  searchText: string; // Pre-computed lowercase searchable text
  userIds: Set<string>; // All mentioned user IDs (including replies)
  assetIds: Set<string>; // All mentioned asset IDs (including replies)
  recordIds: Set<string>; // All mentioned record IDs (including replies)
  modelIds: Set<string>; // All mentioned model IDs (including replies)
  authorIds: Set<string>; // Author ID + reply author IDs
};

type CombinedIndexResult = {
  indexedComments: IndexedComment[];
  filterOptions: FilterOptions;
};

/** Extracts mention IDs and text from stored comment segments. */
function extractMentionsFromContent(content: StoredCommentSegment[]) {
  const userIds: string[] = [];
  const assetIds: string[] = [];
  const recordIds: string[] = [];
  const modelIds: string[] = [];
  const textParts: string[] = [];

  for (const segment of content) {
    if (segment.type === 'text') {
      textParts.push(segment.content);
    } else if (segment.type === 'mention') {
      switch (segment.mention.type) {
        case 'user':
          userIds.push(segment.mention.id);
          break;
        case 'asset':
          assetIds.push(segment.mention.id);
          break;
        case 'record':
          recordIds.push(segment.mention.id);
          break;
        case 'model':
          modelIds.push(segment.mention.id);
          break;
        case 'field':
          // Field mentions: can add fieldPath to text if needed
          textParts.push(segment.mention.fieldPath);
          break;
      }
    }
  }

  return { userIds, assetIds, recordIds, modelIds, textParts };
}

type FilterOptionAccumulators = {
  authorsMap: Map<string, AuthorOption>;
  recordsMap: Map<string, RecordOption>;
  assetsMap: Map<string, AssetOption>;
  modelsMap: Map<string, ModelOption>;
  usersMap: Map<string, UserOption>;
};

function indexCommentWithOptions(
  comment: CommentType,
  accumulators: FilterOptionAccumulators
): IndexedComment {
  const userIds = new Set<string>();
  const assetIds = new Set<string>();
  const recordIds = new Set<string>();
  const modelIds = new Set<string>();
  const authorIds = new Set<string>();
  const allTextParts: string[] = [];

  const { authorsMap, recordsMap, assetsMap, modelsMap, usersMap } = accumulators;

  function processComment(c: CommentType) {
    authorIds.add(c.authorId);

    if (!authorsMap.has(c.authorId)) {
      authorsMap.set(c.authorId, {
        id: c.authorId,
        name: `User ${c.authorId.slice(0, 8)}`, // Actual name resolved elsewhere
      });
    }

    const extracted = extractMentionsFromContent(c.content);

    // StoredMention only has IDs - add to sets for filtering
    for (const mentionedUserId of extracted.userIds) {
      userIds.add(mentionedUserId);
      if (!usersMap.has(mentionedUserId)) {
        usersMap.set(mentionedUserId, { id: mentionedUserId, name: `User ${mentionedUserId.slice(0, 8)}` });
      }
    }

    for (const assetId of extracted.assetIds) {
      assetIds.add(assetId);
      if (!assetsMap.has(assetId)) {
        assetsMap.set(assetId, { id: assetId, filename: `Asset ${assetId.slice(0, 8)}` });
      }
    }

    for (const recordId of extracted.recordIds) {
      recordIds.add(recordId);
      if (!recordsMap.has(recordId)) {
        recordsMap.set(recordId, {
          id: recordId,
          title: `Record ${recordId.slice(0, 8)}`,
          modelName: 'Unknown',
        });
      }
    }

    for (const modelId of extracted.modelIds) {
      modelIds.add(modelId);
      if (!modelsMap.has(modelId)) {
        modelsMap.set(modelId, { id: modelId, name: `Model ${modelId.slice(0, 8)}` });
      }
    }

    allTextParts.push(...extracted.textParts);

    if (c.replies) {
      for (const reply of c.replies) {
        processComment(reply);
      }
    }
  }

  processComment(comment);

  return {
    comment,
    dateTimestamp: new Date(comment.dateISO).getTime(),
    searchText: allTextParts.join(' ').toLowerCase(),
    userIds,
    assetIds,
    recordIds,
    modelIds,
    authorIds,
  };
}

function buildCombinedIndex(comments: CommentType[]): CombinedIndexResult {
  const accumulators: FilterOptionAccumulators = {
    authorsMap: new Map<string, AuthorOption>(),
    recordsMap: new Map<string, RecordOption>(),
    assetsMap: new Map<string, AssetOption>(),
    modelsMap: new Map<string, ModelOption>(),
    usersMap: new Map<string, UserOption>(),
  };

  const indexedComments: IndexedComment[] = [];
  for (const comment of comments) {
    const indexed = indexCommentWithOptions(comment, accumulators);
    indexedComments.push(indexed);
  }

  const sortByName = <T extends { name: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name);
  const sortByFilename = (a: AssetOption, b: AssetOption) =>
    a.filename.localeCompare(b.filename);
  const sortByTitle = (a: RecordOption, b: RecordOption) =>
    a.title.localeCompare(b.title);

  const filterOptions: FilterOptions = {
    authors: [...accumulators.authorsMap.values()].sort(sortByName),
    mentionedRecords: [...accumulators.recordsMap.values()].sort(sortByTitle),
    mentionedAssets: [...accumulators.assetsMap.values()].sort(sortByFilename),
    mentionedModels: [...accumulators.modelsMap.values()].sort(sortByName),
    mentionedUsers: [...accumulators.usersMap.values()].sort(sortByName),
  };

  return { indexedComments, filterOptions };
}

function filterIndexedComments(
  indexedComments: IndexedComment[],
  filters: CommentFilters
): CommentType[] {
  const normalizedQuery = filters.searchQuery.toLowerCase().trim();
  const hasDateFilter = filters.dateRange.start || filters.dateRange.end;
  const startTime = filters.dateRange.start?.getTime() ?? 0;
  const endTime = filters.dateRange.end
    ? new Date(filters.dateRange.end).setHours(23, 59, 59, 999)
    : Number.MAX_SAFE_INTEGER;

  const results: CommentType[] = [];

  for (const indexed of indexedComments) {
    if (hasDateFilter) {
      if (indexed.dateTimestamp < startTime || indexed.dateTimestamp > endTime) {
        continue;
      }
    }

    if (filters.authorId && !indexed.authorIds.has(filters.authorId)) {
      continue;
    }

    if (filters.mentionedUserId && !indexed.userIds.has(filters.mentionedUserId)) {
      continue;
    }
    if (filters.mentionedAssetId && !indexed.assetIds.has(filters.mentionedAssetId)) {
      continue;
    }
    if (filters.mentionedRecordId && !indexed.recordIds.has(filters.mentionedRecordId)) {
      continue;
    }
    if (filters.mentionedModelId && !indexed.modelIds.has(filters.mentionedModelId)) {
      continue;
    }

    if (normalizedQuery && !indexed.searchText.includes(normalizedQuery)) {
      continue;
    }

    results.push(indexed.comment);
  }

  return results;
}

function hasActiveFilters(filters: CommentFilters): boolean {
  return (
    filters.searchQuery.trim() !== '' ||
    filters.authorId !== null ||
    filters.dateRange.start !== null ||
    filters.dateRange.end !== null ||
    filters.mentionedRecordId !== null ||
    filters.mentionedAssetId !== null ||
    filters.mentionedModelId !== null ||
    filters.mentionedUserId !== null
  );
}

function filtersAreEqual(a: CommentFilters, b: CommentFilters): boolean {
  return (
    a.searchQuery === b.searchQuery &&
    a.authorId === b.authorId &&
    a.dateRange.start?.getTime() === b.dateRange.start?.getTime() &&
    a.dateRange.end?.getTime() === b.dateRange.end?.getTime() &&
    a.mentionedRecordId === b.mentionedRecordId &&
    a.mentionedAssetId === b.mentionedAssetId &&
    a.mentionedModelId === b.mentionedModelId &&
    a.mentionedUserId === b.mentionedUserId
  );
}

/** Builds search index and filter options in single pass. */
export function useCommentFilters(comments: CommentType[]) {
  const [pendingFilters, setPendingFilters] = useState<CommentFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<CommentFilters>(initialFilters);

  const { indexedComments, filterOptions } = useMemo(
    () => buildCombinedIndex(comments),
    [comments]
  );

  const filteredComments = useMemo(
    () => filterIndexedComments(indexedComments, appliedFilters),
    [indexedComments, appliedFilters]
  );

  const isFiltering = useMemo(() => hasActiveFilters(appliedFilters), [appliedFilters]);

  const hasUnappliedChanges = useMemo(
    () => !filtersAreEqual(pendingFilters, appliedFilters),
    [pendingFilters, appliedFilters]
  );

  const applyFilters = useCallback(() => {
    setAppliedFilters(pendingFilters);
  }, [pendingFilters]);

  const clearFilters = useCallback(() => {
    setPendingFilters(initialFilters);
    setAppliedFilters(initialFilters);
  }, []);

  const updateFilter = useCallback(
    <K extends keyof CommentFilters>(key: K, value: CommentFilters[K]) => {
      setPendingFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return {
    filters: pendingFilters,
    setFilters: setPendingFilters,
    updateFilter,
    filterOptions,
    filteredComments,
    isFiltering,
    hasUnappliedChanges,
    applyFilters,
    clearFilters,
  };
}
