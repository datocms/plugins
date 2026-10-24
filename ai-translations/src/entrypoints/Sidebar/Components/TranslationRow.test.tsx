import { act, fireEvent, screen } from '@testing-library/react';
import RowList from 'datocms-react-ui/RowList';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithCanvas } from '../../../test/renderWithCanvas';
import { PENDING_HINT_THRESHOLD_SECONDS } from '../../../utils/constants';
import {
  TranslationRow,
  type TranslationRowState,
  type TranslationRowStatus,
} from './TranslationRow';

function row(status: TranslationRowStatus): TranslationRowState {
  return {
    id: 'body.it',
    fieldLabel: 'Body',
    locale: 'it',
    baseFieldPath: 'body',
    status,
  };
}

function renderRow(state: TranslationRowState, onOpen = vi.fn()) {
  const result = renderWithCanvas(
    <RowList>
      <TranslationRow row={state} vendor="openai" onOpen={onOpen} />
    </RowList>,
  );
  return { ...result, onOpen };
}

describe('TranslationRow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['done', 'Translated'],
    ['error', 'Failed'],
    ['pending', 'Translating…'],
  ] as const)(
    'names a %s row by its field, locale and state',
    (status, word) => {
      renderRow(row(status));

      // jsdom joins the title and the details without the space a browser
      // puts between the two lines.
      expect(
        screen.getByRole('button', {
          name: new RegExp(`^Body\\s*Italian \\[it\\] · ${word}$`),
        }),
      ).toBeInTheDocument();
    },
  );

  it('says a large field is still translating after a while', () => {
    vi.useFakeTimers();
    renderRow(row('pending'));

    act(() => {
      vi.advanceTimersByTime(PENDING_HINT_THRESHOLD_SECONDS * 1000 - 1);
    });
    expect(screen.getByRole('button')).toHaveTextContent('Translating…');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button')).toHaveTextContent(
      'Still translating a large field…',
    );
  });

  it('opens its field on a click', () => {
    const state = row('done');
    const { onOpen } = renderRow(state);

    fireEvent.click(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledWith(state);
  });
});
