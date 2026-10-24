import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ALL_SCOPE, type Scope } from '../report/scope';
import { modalContext } from '../test/fixtures';
import ScopeModal, { type ScopeModalParams } from './ScopeModal';

function params(overrides: Partial<ScopeModalParams> = {}): ScopeModalParams {
  return {
    environment: 'main',
    models: [
      { id: 'news', name: 'News' },
      { id: 'page', name: 'Page' },
    ],
    locales: [
      { code: 'en', label: 'English' },
      { code: 'it', label: 'Italian' },
    ],
    scope: ALL_SCOPE,
    ...overrides,
  };
}

function renderModal(parameters: Record<string, unknown>) {
  const ctx = modalContext(parameters);
  render(<ScopeModal ctx={ctx} />);
  return ctx;
}

const radio = (name: string) => screen.getByRole('radio', { name });
// The required fields' names end with the asterisk of their label.
const modelSelect = () =>
  screen.queryByRole('combobox', { name: /^Models to scan/ });
const localeSelect = () =>
  screen.queryByRole('combobox', { name: /^Locales to scan/ });
const submit = () => screen.getByRole('button', { name: 'Scan links' });

/** Opens a react-select and picks an option by its label. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  select: HTMLElement,
  label: string,
) {
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: label }));
}

/** The picked values of a multiple select, from the labels of its pills. */
function pills(select: HTMLElement) {
  const field = select.closest('.form__field');
  if (!(field instanceof HTMLElement)) return [];
  return Array.from(
    field.querySelectorAll('.SelectInput__multi-value-label'),
    (label) => label.textContent,
  );
}

describe('scope modal', () => {
  it('scans everything by default', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(params());
    expect(screen.getByText('main')).toHaveClass('IdText');
    expect(radio('All models')).toBeChecked();
    expect(radio('All locales')).toBeChecked();
    expect(modelSelect()).not.toBeInTheDocument();
    expect(localeSelect()).not.toBeInTheDocument();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: 'all',
      localeIds: 'all',
    } satisfies Scope);
  });

  it('reveals the model select and asks for a model before scanning', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(params());
    await user.click(radio('Only some models'));
    const models = modelSelect();
    expect(models).toBeInTheDocument();
    if (!models) return;
    expect(screen.queryByText('Pick at least one model.')).toBeNull();
    await user.click(submit());
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Pick at least one model.')).toBeInTheDocument();
    expect(models).toHaveAttribute('aria-invalid', 'true');
    expect(models).toHaveFocus();
    await pick(user, models, 'Page');
    expect(screen.queryByText('Pick at least one model.')).toBeNull();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: ['page'],
      localeIds: 'all',
    } satisfies Scope);

    await user.click(radio('All models'));
    expect(modelSelect()).not.toBeInTheDocument();
  });

  it('asks for a locale when only the locale list is empty', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(
      params({ scope: { modelIds: ['page'], localeIds: 'all' } }),
    );
    await user.click(radio('Only some locales'));
    await user.click(submit());
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Pick at least one locale.')).toBeInTheDocument();
    expect(screen.queryByText('Pick at least one model.')).toBeNull();
    const locales = localeSelect();
    expect(locales).toHaveFocus();
    if (!locales) return;
    await pick(user, locales, 'Italian');
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: ['page'],
      localeIds: ['it'],
    } satisfies Scope);
  });

  it('opens on a limited scope with "Only some" picked and the selects filled', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(
      params({
        scope: { modelIds: ['page', 'deleted-model'], localeIds: ['it'] },
      }),
    );
    expect(radio('Only some models')).toBeChecked();
    expect(radio('Only some locales')).toBeChecked();
    const models = modelSelect();
    const locales = localeSelect();
    expect(models).toBeInTheDocument();
    expect(locales).toBeInTheDocument();
    if (!models || !locales) return;
    // The model that no longer exists is dropped.
    expect(pills(models)).toEqual(['Page']);
    expect(pills(locales)).toEqual(['Italian']);
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: ['page'],
      localeIds: ['it'],
    } satisfies Scope);
  });

  it('has no locale choice on a single-locale site', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(
      params({
        locales: [{ code: 'en', label: 'English' }],
        scope: { modelIds: 'all', localeIds: ['en'] },
      }),
    );
    expect(screen.queryByRole('radio', { name: 'All locales' })).toBeNull();
    expect(localeSelect()).not.toBeInTheDocument();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: 'all',
      localeIds: 'all',
    } satisfies Scope);
  });

  it('falls back to the whole project when the parameters are invalid', async () => {
    const user = userEvent.setup();
    const ctx = renderModal({ scope: { modelIds: 42 } });
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(radio('All models')).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'All locales' })).toBeNull();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith(ALL_SCOPE);
  });
});
