import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, renderWithCanvas } from '../test/renderWithCanvas';
import TranslationConfirmModal, {
  isTranslationConfirmModalParams,
  type TranslationConfirmModalParams,
} from './TranslationConfirmModal';

function renderModal(parameters: TranslationConfirmModalParams) {
  const ctx = makeCtx<RenderModalCtx>({ resolve: vi.fn() });
  renderWithCanvas(
    <TranslationConfirmModal ctx={ctx} parameters={parameters} />,
    ctx,
  );
  return ctx;
}

/** The value of an InfoList row, found by its title. */
function rowValue(title: string) {
  const term = screen
    .getAllByRole('term')
    .find((element) => element.textContent === title);
  return term?.nextElementSibling?.textContent;
}

describe('TranslationConfirmModal', () => {
  afterEach(cleanup);

  it('reviews the locales and the fields of each model', () => {
    renderModal({
      recordCount: 12,
      fromLocale: 'en',
      toLocales: ['it', 'fr'],
      models: [
        {
          label: 'Blog post',
          code: 'blog_post',
          fields: [
            { label: 'Title', apiKey: 'title' },
            { label: 'Body', apiKey: 'body' },
          ],
        },
        { label: 'Author', code: 'author', fields: [] },
      ],
    });

    expect(
      screen.getByText(
        'This translates 12 records across 2 models into 2 locales.',
      ),
    ).toBeTruthy();
    expect(rowValue('From')).toBe('English [en]');
    expect(rowValue('To')).toBe('Italian [it], French [fr]');
    expect(screen.getByText('Models and fields')).toBeTruthy();
    expect(rowValue('Blog post blog_post')).toBe('Title, Body');
    expect(rowValue('Author author')).toBe('No fields selected');
    expect(screen.queryByText('Large translation')).toBeNull();
  });

  it('warns about a large run', () => {
    renderModal({
      recordCount: 5000,
      fromLocale: 'en',
      toLocales: ['it', 'fr'],
    });

    expect(screen.getByText(/into 2 locales\.$/)).toBeTruthy();
    expect(screen.queryByText('Models and fields')).toBeNull();
    const warning = screen.getByRole('alert');
    expect(within(warning).getByText('Large translation')).toBeTruthy();
  });

  it('resolves true to start and false to cancel', () => {
    const ctx = renderModal({
      recordCount: 1,
      fromLocale: 'en',
      toLocales: ['it'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Translate 1 record' }));
    expect(ctx.resolve).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ctx.resolve).toHaveBeenLastCalledWith(false);
  });

  it('cancels on Escape, as the host draws no cross', () => {
    const ctx = renderModal({
      recordCount: 1,
      fromLocale: 'en',
      toLocales: ['it'],
    });

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(ctx.resolve).toHaveBeenCalledTimes(1);
    expect(ctx.resolve).toHaveBeenCalledWith(false);
  });

  it('accepts only complete parameters', () => {
    expect(
      isTranslationConfirmModalParams({
        recordCount: 1,
        fromLocale: 'en',
        toLocales: ['it'],
      }),
    ).toBe(true);
    expect(isTranslationConfirmModalParams({ recordCount: 1 })).toBe(false);
    expect(isTranslationConfirmModalParams(null)).toBe(false);
  });
});
