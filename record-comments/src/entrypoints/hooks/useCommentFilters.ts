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

/**
 * Preprocessed comment data for efficient filtering
 */
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

/**
 * Combined result from building index and extracting filter options in one pass
 */
type CombinedIndexResult = {
  indexedComments: IndexedComment[];
  filterOptions: FilterOptions;
};

/**
 * Extract mentions from content segments (single pass)
 */
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

/**
 * Accumulator maps for collecting filter options during indexing
 */
type FilterOptionAccumulators = {
  authorsMap: Map<string, AuthorOption>;
  recordsMap: Map<string, RecordOption>;
  assetsMap: Map<string, AssetOption>;
  modelsMap: Map<string, ModelOption>;
  usersMap: Map<string, UserOption>;
};

/**
 * Build index for a single comment while also populating filter option accumulators
 */
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
    // Add author to both index and filter options
    authorEmails.add(c.author.email);
    allTextParts.push(c.author.name);

    if (!authorsMap.has(c.author.email)) {
      authorsMap.set(c.author.email, {
        email: c.author.email,
        name: c.author.name,
      });
    }

    // Extract mentions and text in single pass
    const extracted = extractMentionsFromContent(c.content);

    // Process user mentions - add to both index and filter options
    for (const user of extracted.userMentions) {
      userEmails.add(user.email);
      if (!usersMap.has(user.email)) {
        usersMap.set(user.email, { email: user.email, name: user.name });
      }
    }

    // Process asset mentions - add to both index and filter options
    for (const asset of extracted.assetMentions) {
      assetIds.add(asset.id);
      if (!assetsMap.has(asset.id)) {
        assetsMap.set(asset.id, { id: asset.id, filename: asset.filename });
      }
    }

    // Process record mentions - add to both index and filter options
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

    // Process model mentions - add to both index and filter options
    for (const model of extracted.modelMentions) {
      modelIds.add(model.id);
      if (!modelsMap.has(model.id)) {
        modelsMap.set(model.id, { id: model.id, name: model.name });
      }
    }

    allTextParts.push(...extracted.textParts);

    // Process replies
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

/**
 * Build search index and extract filter options in a single pass over all comments
 */
function buildCombinedIndex(comments: CommentType[]): CombinedIndexResult {
  // Initialize accumulator maps for filter options
  const accumulators: FilterOptionAccumulators = {
    authorsMap: new Map<string, AuthorOption>(),
    recordsMap: new Map<string, RecordOption>(),
    assetsMap: new Map<string, AssetOption>(),
    modelsMap: new Map<string, ModelOption>(),
    usersMap: new Map<string, UserOption>(),
  };

  // Build indexed comments while populating filter option accumulators
  const indexedComments: IndexedComment[] = [];
  for (const comment of comments) {
    const indexed = indexCommentWithOptions(comment, accumulators);
    indexedComments.push(indexed);
  }

  // Sort helpers
  const sortByName = <T extends { name: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name);
  const sortByFilename = (a: AssetOption, b: AssetOption) =>
    a.filename.localeCompare(b.filename);
  const sortByTitle = (a: RecordOption, b: RecordOption) =>
    a.title.localeCompare(b.title);

  // Build sorted filter options from accumulator maps
  const filterOptions: FilterOptions = {
    authors: [...accumulators.authorsMap.values()].sort(sortByName),
    mentionedRecords: [...accumulators.recordsMap.values()].sort(sortByTitle),
    mentionedAssets: [...accumulators.assetsMap.values()].sort(sortByFilename),
    mentionedModels: [...accumulators.modelsMap.values()].sort(sortByName),
    mentionedUsers: [...accumulators.usersMap.values()].sort(sortByName),
  };

  return { indexedComments, filterOptions };
}

/**
 * Filter indexed comments efficiently (single pass through each comment)
 */
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
    // Date filter (fast numeric comparison)
    if (hasDateFilter) {
      if (indexed.dateTimestamp < startTime || indexed.dateTimestamp > endTime) {
        continue;
      }
    }

    // Author filter (Set lookup - O(1))
    if (filters.authorEmail && !indexed.authorEmails.has(filters.authorEmail)) {
      continue;
    }

    // Mention filters (Set lookups - O(1) each)
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

    // Search filter (pre-computed lowercase string)
    if (normalizedQuery && !indexed.searchText.includes(normalizedQuery)) {
      continue;
    }

    results.push(indexed.comment);
  }

  return results;
}

/**
 * Check if any filters are active
 */
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

/**
 * Check if two filter states are equal
 */
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

/**
 * Hook for managing comment filters with optimized performance
 * Uses pending/applied pattern - filters only take effect when applied
 *
 * PERFORMANCE DESIGN DECISIONS:
 *
 * 1. EAGER INDEX BUILDING (current approach):
 *    The search index is built immediately when comments change, not lazily when
 *    filters are first opened. This is intentional because:
 *    - Index building is O(n) and happens once per comment change
 *    - Subsequent filter operations are very fast (Set lookups are O(1))
 *    - Lazy building would cause noticeable UI lag when first opening filters
 *    - Most dashboards with comments will eventually use filters
 *
 * 2. SINGLE-PASS INDEXING:
 *    buildCombinedIndex extracts both the search index AND filter options in one
 *    pass over the comments array. This avoids iterating comments twice.
 *
 * 3. PRE-COMPUTED SEARCH TEXT:
 *    Each indexed comment has a pre-computed lowercase search string, avoiding
 *    repeated toLowerCase() calls during filtering.
 *
 * POTENTIAL FUTURE OPTIMIZATIONS (not implemented - premature optimization):
 * - Web Worker: Move indexing off the main thread for 1000+ comments
 * - Incremental updates: Add/remove individual comments from index instead of rebuilding
 * - Virtual scrolling: If filter results exceed 100+ items, virtualize the list
 *
 * REVIEWED 2024-12: Lazy initialization was considered but rejected because:
 * - It would cause noticeable UI lag when first opening filters (bad UX)
 * - Index building is O(n) which is fast for typical comment counts (<500)
 * - The cost is amortized since most users will eventually use filters
 * - Lazy init would require additional state tracking (hasOpenedFilters)
 * DO NOT change to lazy initialization without profiling real-world usage.
 */
export function useCommentFilters(comments: CommentType[]) {
  // Pending filters (what user is editing)
  const [pendingFilters, setPendingFilters] = useState<CommentFilters>(initialFilters);
  // Applied filters (what's actually filtering)
  const [appliedFilters, setAppliedFilters] = useState<CommentFilters>(initialFilters);

  /**
   * Build search index and extract filter options in a single pass.
   *
   * IMPORTANT: Only rebuilds when the `comments` array reference changes.
   * React's useMemo ensures this is NOT rebuilt on every render or poll cycle.
   * If parent components pass a stable comments array (which they do via their
   * own useMemo/useCallback), this computation runs once per actual data change.
   *
   * See PERFORMANCE DESIGN DECISIONS above for why eager (not lazy) building is used.
   */
  const { indexedComments, filterOptions } = useMemo(
    () => buildCombinedIndex(comments),
    [comments]
  );

  // Apply filters using indexed data (uses appliedFilters, not pending)
  const filteredComments = useMemo(
    () => filterIndexedComments(indexedComments, appliedFilters),
    [indexedComments, appliedFilters]
  );

  // Check if applied filters are active
  const isFiltering = useMemo(() => hasActiveFilters(appliedFilters), [appliedFilters]);

  // Check if there are unapplied changes
  const hasUnappliedChanges = useMemo(
    () => !filtersAreEqual(pendingFilters, appliedFilters),
    [pendingFilters, appliedFilters]
  );

  // Apply pending filters
  const applyFilters = useCallback(() => {
    setAppliedFilters(pendingFilters);
  }, [pendingFilters]);

  // Clear all filters (both pending and applied)
  const clearFilters = useCallback(() => {
    setPendingFilters(initialFilters);
    setAppliedFilters(initialFilters);
  }, []);

  // Update a single pending filter
  const updateFilter = useCallback(
    <K extends keyof CommentFilters>(key: K, value: CommentFilters[K]) => {
      setPendingFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return {
    filters: pendingFilters, // For UI binding
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
