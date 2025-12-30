import { useMemo } from 'react';
import type { FilterOptions } from '@hooks/useCommentFilters';

export type TransformedFilterOptions = {
  authorOptions: { value: string; label: string }[];
  recordOptions: { value: string; label: string; sublabel: string }[];
  assetOptions: { value: string; label: string }[];
  modelOptions: { value: string; label: string }[];
  userOptions: { value: string; label: string }[];
};

export function useFilterOptionsTransform(filterOptions: FilterOptions): TransformedFilterOptions {
  return useMemo(
    () => ({
      authorOptions: filterOptions.authors.map((a) => ({
        value: a.email,
        label: a.name,
      })),
      recordOptions: filterOptions.mentionedRecords.map((r) => ({
        value: r.id,
        label: r.title,
        sublabel: r.modelName,
      })),
      assetOptions: filterOptions.mentionedAssets.map((a) => ({
        value: a.id,
        label: a.filename,
      })),
      modelOptions: filterOptions.mentionedModels.map((m) => ({
        value: m.id,
        label: m.name,
      })),
      userOptions: filterOptions.mentionedUsers.map((u) => ({
        value: u.email,
        label: u.name,
      })),
    }),
    [filterOptions]
  );
}
