/**
 * useModelPickerPage.tsx
 * ----------------------
 * Pages the field pickers of the selected models, 50 at a time, so a run
 * over thousands of models doesn't render thousands of selects. The pages
 * only change what shows: the job still gets every selected model.
 */
import Toolbar from 'datocms-react-ui/Toolbar';
import { useState } from 'react';

/** Small selections retain the original, uninterrupted field-picker layout. */
export const MODEL_PICKERS_PER_PAGE = 50;

export type ModelPickerPageOptions = {
  /**
   * Fewer page numbers, for a narrow place (the records-picker dialog). The
   * bulk page is wide enough for the full pagination.
   */
  compact?: boolean;
};

/**
 * @param models - The selected models, in selection order.
 * @param options - How the pagination shows.
 * @returns The models of the current page, and the pagination bar to place
 *   (`null` at 50 models or fewer, when every picker shows).
 */
export function useModelPickerPage<T>(
  models: readonly T[],
  { compact = false }: ModelPickerPageOptions = {},
) {
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.ceil(models.length / MODEL_PICKERS_PER_PAGE);
  // A shrinking selection keeps the user on its last page.
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1));
  const start = page * MODEL_PICKERS_PER_PAGE;
  const paged = pageCount > 1;

  return {
    visibleModels: paged
      ? models.slice(start, start + MODEL_PICKERS_PER_PAGE)
      : models,
    pagination: paged ? (
      <Toolbar style="short">
        <Toolbar.Pagination
          ariaLabel="Selected models"
          compact={compact}
          perPage={MODEL_PICKERS_PER_PAGE}
          currentPage={page}
          totalEntries={models.length}
          onChange={setPage}
        />
      </Toolbar>
    ) : null,
  };
}
