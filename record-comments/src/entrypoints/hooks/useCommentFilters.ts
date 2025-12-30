import { useState, useMemo, useCallback } from 'react';
import type { CommentType } from '@ctypes/comments';
import type {
  CommentSegment,
  UserMention,
  AssetMention,
  RecordMention,
  ModelMention,
} from '@ctypes/mentions';

// Filter state types
export type CommentFilters = {
  searchQuery: string;
  authorEmail: string | null;
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  mentionedRecordId: string | null;
  mentionedAssetId: string | null;
  mentionedModelId: string | null;
  mentionedUserEmail: string | null;
};

// Option types for dropdowns
export type AuthorOption = {
  email: string;
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
  email: string;
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
  authorEmail: null,
  dateRange: { start: null, end: null },
  mentionedRecordId: null,
  mentionedAssetId: null,
  mentionedModelId: null,
  mentionedUserEmail: null,
};

type IndexedComment = {
  comment: CommentType;
  dateTimestamp: number;
  searchText: string; // Pre-computed lowercase searchable text
  userEmails: Set<string>; // All mentioned user emails (including replies)
  assetIds: Set<string>; // All mentioned asset IDs (including replies)
  recordIds: Set<string>; // All mentioned record IDs (including replies)
  modelIds: Set<string>; // All mentioned model IDs (including replies)
  authorEmails: Set<string>; // Author email + reply author emails
};

type CombinedIndexResult = {
  indexedComments: IndexedComment[];
  filterOptions: FilterOptions;
};

function extractMentionsFromContent(content: CommentSegment[]) {
  const userMentions: UserMention[] = [];
  const assetMentions: AssetMention[] = [];
  const recordMentions: RecordMention[] = [];
  const modelMentions: ModelMention[] = [];
  const textParts: string[] = [];

  for (const segment of content) {
    if (segment.type === 'text') {
      textParts.push(segment.content);
    } else if (segment.type === 'mention') {
      switch (segment.mention.type) {
        case 'user':
          userMentions.push(segment.mention);
          textParts.push(segment.mention.name);
          break;
        case 'asset':
          assetMentions.push(segment.mention);
          textParts.push(segment.mention.filename);
          break;
        case 'record':
          recordMentions.push(segment.mention);
          textParts.push(segment.mention.title);
          break;
        case 'model':
          modelMentions.push(segment.mention);
          textParts.push(segment.mention.name);
          break;
        case 'field':
          textParts.push(segment.mention.label);
          break;
      }
    }
  }

  return { userMentions, assetMentions, recordMentions, modelMentions, textParts };
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
  const userEmails = new Set<string>();
  const assetIds = new Set<string>();
  const recordIds = new Set<string>();
  const modelIds = new Set<string>();
  const authorEmails = new Set<string>();
  const allTextParts: string[] = [];

  const { authorsMap, recordsMap, assetsMap, modelsMap, usersMap } = accumulators;

  function processComment(c: CommentType) {
    authorEmails.add(c.author.email);
    allTextParts.push(c.author.name);

    if (!authorsMap.has(c.author.email)) {
      authorsMap.set(c.author.email, {
        email: c.author.email,
        name: c.author.name,
      });
    }

    const extracted = extractMentionsFromContent(c.content);

    for (const user of extracted.userMentions) {
      userEmails.add(user.email);
      if (!usersMap.has(user.email)) {
        usersMap.set(user.email, { email: user.email, name: user.name });
      }
    }

    for (const asset of extracted.assetMentions) {
      assetIds.add(asset.id);
      if (!assetsMap.has(asset.id)) {
        assetsMap.set(asset.id, { id: asset.id, filename: asset.filename });
      }
    }

    for (const record of extracted.recordMentions) {
      recordIds.add(record.id);
      if (!recordsMap.has(record.id)) {
        recordsMap.set(record.id, {
          id: record.id,
          title: record.title,
          modelName: record.modelName,
        });
      }
    }

    for (const model of extracted.modelMentions) {
      modelIds.add(model.id);
      if (!modelsMap.has(model.id)) {
        modelsMap.set(model.id, { id: model.id, name: model.name });
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
    userEmails,
    assetIds,
    recordIds,
    modelIds,
    authorEmails,
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

    if (filters.authorEmail && !indexed.authorEmails.has(filters.authorEmail)) {
      continue;
    }

    if (filters.mentionedUserEmail && !indexed.userEmails.has(filters.mentionedUserEmail)) {
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
    filters.authorEmail !== null ||
    filters.dateRange.start !== null ||
    filters.dateRange.end !== null ||
    filters.mentionedRecordId !== null ||
    filters.mentionedAssetId !== null ||
    filters.mentionedModelId !== null ||
    filters.mentionedUserEmail !== null
  );
}

function filtersAreEqual(a: CommentFilters, b: CommentFilters): boolean {
  return (
    a.searchQuery === b.searchQuery &&
    a.authorEmail === b.authorEmail &&
    a.dateRange.start?.getTime() === b.dateRange.start?.getTime() &&
    a.dateRange.end?.getTime() === b.dateRange.end?.getTime() &&
    a.mentionedRecordId === b.mentionedRecordId &&
    a.mentionedAssetId === b.mentionedAssetId &&
    a.mentionedModelId === b.mentionedModelId &&
    a.mentionedUserEmail === b.mentionedUserEmail
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
