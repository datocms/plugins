import { act, fireEvent, screen } from '@testing-library/react';
import RowList from 'datocms-react-ui/RowList';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithCanvas } from '../../../test/renderWithCanvas';
import { PENDING_HINT_THRESHOLD_SECONDS } from '../../../utils/constants';
import {
  type FieldRowState,
  fieldRows,
  localeToOpen,
  TranslationRow,
  type TranslationRowStatus,
} from './TranslationRow';

/** The Body field, with the state of each of its target locales. */
function field(...statuses: [string, TranslationRowStatus][]): FieldRowState {
  return {
    fieldLabel: 'Body',
    baseFieldPath: 'body',
    locales: statuses.map(([locale, status]) => ({ locale, status })),
  };
}

function renderRow(state: FieldRowState, onOpen = vi.fn()) {
  const result = renderWithCanvas(
    <RowList>
      <TranslationRow field={state} onOpen={onOpen} />
    </RowList>,
  );
  return { ...result, onOpen };
}

/**
 * The row by its name. jsdom joins the title and the details without the
 * space a browser puts between the two lines.
 */
function rowNamed(details: string) {
  const escaped = details.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return screen.getByRole('button', {
    name: new RegExp(`^Body\\s*${escaped}$`),
  });
}

describe('TranslationRow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says the state of the field in all its locales', () => {
    renderRow(field(['it', 'pending'], ['de', 'done'], ['fr', 'done']));
    expect(rowNamed('Translating into 3 locales…')).toBeInTheDocument();
  });

  it('names the locale of a run into one locale', () => {
    renderRow(field(['it', 'done']));
    expect(rowNamed('Translated into Italian [it]')).toBeInTheDocument();
  });

  it('counts the translated locales and names the ones that failed', () => {
    renderRow(field(['it', 'done'], ['de', 'error'], ['fr', 'done']));
    const row = rowNamed('Translated into 2 of 3 locales. German [de] failed.');
    // Partly translated: amber, as in the progress modal.
    expect(row.querySelector('.FeedbackDot--warning')).not.toBeNull();
  });

  it('says Failed when no locale was translated', () => {
    renderRow(field(['it', 'error'], ['de', 'error']));
    expect(
      rowNamed('Failed').querySelector('.FeedbackDot--danger'),
    ).not.toBeNull();
  });

  it('says a large field is still translating after a while', () => {
    vi.useFakeTimers();
    renderRow(field(['it', 'pending'], ['de', 'pending']));

    act(() => {
      vi.advanceTimersByTime(PENDING_HINT_THRESHOLD_SECONDS * 1000 - 1);
    });
    expect(screen.getByRole('button')).toHaveTextContent(
      'Translating into 2 locales…',
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button')).toHaveTextContent(
      'Still translating a large field…',
    );
  });

  it('opens its field on a click', () => {
    const state = field(['it', 'done']);
    const { onOpen } = renderRow(state);

    fireEvent.click(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledWith(state);
  });
});

describe('fieldRows', () => {
  it('groups the locales of each field, in the order the fields started', () => {
    const rows = fieldRows(
      [
        {
          id: 'title.it',
          fieldLabel: 'Title',
          locale: 'it',
          baseFieldPath: 'title',
          status: 'done',
        },
        {
          id: 'body.it',
          fieldLabel: 'Body',
          locale: 'it',
          baseFieldPath: 'body',
          status: 'pending',
        },
        {
          id: 'title.de',
          fieldLabel: 'Title',
          locale: 'de',
          baseFieldPath: 'title',
          status: 'error',
        },
      ],
      ['it', 'de'],
      false,
    );

    expect(rows).toEqual([
      {
        fieldLabel: 'Title',
        baseFieldPath: 'title',
        locales: [
          { locale: 'it', status: 'done' },
          { locale: 'de', status: 'error' },
        ],
      },
      {
        fieldLabel: 'Body',
        baseFieldPath: 'body',
        // A locale that hasn't started is pending while the run goes on.
        locales: [
          { locale: 'it', status: 'pending' },
          { locale: 'de', status: 'pending' },
        ],
      },
    ]);
  });

  it('counts a locale that never started as failed once the run ended', () => {
    const [body] = fieldRows(
      [
        {
          id: 'body.it',
          fieldLabel: 'Body',
          locale: 'it',
          baseFieldPath: 'body',
          status: 'done',
        },
      ],
      ['it', 'de'],
      true,
    );
    expect(body?.locales).toEqual([
      { locale: 'it', status: 'done' },
      { locale: 'de', status: 'error' },
    ]);
  });

  it('opens the first locale that failed, else the first one', () => {
    expect(localeToOpen(field(['it', 'done'], ['de', 'error']))).toBe('de');
    expect(localeToOpen(field(['it', 'done'], ['de', 'done']))).toBe('it');
  });
});
