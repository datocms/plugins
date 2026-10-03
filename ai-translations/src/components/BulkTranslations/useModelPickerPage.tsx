import { useState } from 'react';
import { Button } from '../../ui/Button';

/** Small selections retain the original, uninterrupted field-picker layout. */
export const MODEL_PICKERS_PER_PAGE = 50;

export function useModelPickerPage<T>(models: readonly T[]) {
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.ceil(models.length / MODEL_PICKERS_PER_PAGE);
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1));
  const start = page * MODEL_PICKERS_PER_PAGE;
  const controls =
    pageCount > 1 ? (
      <div
        role="navigation"
        aria-label="Model fields pages"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-m)',
        }}
      >
        <Button
          buttonSize="s"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous models
        </Button>
        <span role="status">
          Models {(start + 1).toLocaleString()}–
          {Math.min(
            start + MODEL_PICKERS_PER_PAGE,
            models.length,
          ).toLocaleString()}{' '}
          of {models.length.toLocaleString()}
        </span>
        <Button
          buttonSize="s"
          disabled={page === pageCount - 1}
          onClick={() => setPage(page + 1)}
        >
          Next models
        </Button>
      </div>
    ) : null;
  return {
    visibleModels:
      pageCount > 1
        ? models.slice(start, start + MODEL_PICKERS_PER_PAGE)
        : models,
    controls,
  };
}
