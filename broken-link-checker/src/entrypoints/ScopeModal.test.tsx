import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ALL_SCOPE, type Scope } from '../report/scope';
import { modalContext } from '../test/fixtures';
import ScopeModal, { type ScopeModalParams } from './ScopeModal';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

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

const modelSwitch = () =>
  screen.getByRole('switch', { name: 'Limit to specific models?' });
const localeSwitch = () =>
  screen.queryByRole('switch', { name: 'Limit to specific locales?' });
const submit = () => screen.getByRole('button', { name: 'Scan links' });

describe('scope modal', () => {
  it('scans everything by default', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(params());
    expect(screen.getByText('main')).toHaveClass('blc-code');
    expect(modelSwitch()).not.toBeChecked();
    expect(localeSwitch()).not.toBeChecked();
    expect(screen.queryByLabelText('Models')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Locales')).not.toBeInTheDocument();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: 'all',
      localeIds: 'all',
    } satisfies Scope);
  });

  it('reveals the model select and asks for a model before scanning', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(params());
    await user.click(modelSwitch());
    // The kit's label points at the select's container, so the name comes from aria-label.
    const models = screen.getByRole('listbox', { name: 'Models' });
    expect(screen.queryByText('Field is required')).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
    await user.click(submit());
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Field is required')).toBeInTheDocument();
    expect(models).toHaveFocus();
    await user.selectOptions(models, 'page');
    expect(screen.queryByText('Field is required')).not.toBeInTheDocument();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: ['page'],
      localeIds: 'all',
    } satisfies Scope);

    await user.click(modelSwitch());
    expect(screen.queryByLabelText('Models')).not.toBeInTheDocument();
  });

  it('asks for a locale when only the locale list is empty', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(
      params({ scope: { modelIds: ['page'], localeIds: 'all' } }),
    );
    await user.click(
      screen.getByRole('switch', { name: 'Limit to specific locales?' }),
    );
    await user.click(submit());
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getAllByText('Field is required')).toHaveLength(1);
    const locales = screen.getByRole('listbox', { name: 'Locales' });
    expect(locales).toHaveFocus();
    await user.selectOptions(locales, 'it');
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: ['page'],
      localeIds: ['it'],
    } satisfies Scope);
  });

  it('opens on a limited scope with the switches on and the selects filled', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(
      params({
        scope: { modelIds: ['page', 'deleted-model'], localeIds: ['it'] },
      }),
    );
    expect(modelSwitch()).toBeChecked();
    expect(localeSwitch()).toBeChecked();
    const models = screen.getByLabelText<HTMLSelectElement>('Models');
    const locales = screen.getByLabelText<HTMLSelectElement>('Locales');
    expect(
      Array.from(models.selectedOptions, (option) => option.value),
    ).toEqual(['page']);
    expect(
      Array.from(locales.selectedOptions, (option) => option.value),
    ).toEqual(['it']);
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith({
      modelIds: ['page'],
      localeIds: ['it'],
    } satisfies Scope);
  });

  it('has no locale switch on a single-locale site', async () => {
    const user = userEvent.setup();
    const ctx = renderModal(
      params({
        locales: [{ code: 'en', label: 'English' }],
        scope: { modelIds: 'all', localeIds: ['en'] },
      }),
    );
    expect(localeSwitch()).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Locales')).not.toBeInTheDocument();
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
    expect(modelSwitch()).not.toBeChecked();
    expect(localeSwitch()).not.toBeInTheDocument();
    await user.click(submit());
    expect(ctx.resolve).toHaveBeenCalledWith(ALL_SCOPE);
  });
});
