import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, renderWithCanvas } from '../../test/renderWithCanvas';
import type { TranslatableField } from '../../utils/translation/BulkTranslationHelpers';
import {
  ModelFieldPicker,
  type ModelFieldPickerProps,
} from './ModelFieldPicker';

const fields: TranslatableField[] = [
  { id: 'f1', apiKey: 'title', label: 'Title', editor: 'single_line' },
  { id: 'f2', apiKey: 'body', label: 'Body', editor: 'wysiwyg' },
];

const model = { label: 'Articles', value: 'article', code: 'article' };

function renderPicker(overrides: Partial<ModelFieldPickerProps> = {}) {
  const props: ModelFieldPickerProps = {
    model,
    fields,
    isLoading: false,
    selectedApiKeys: ['title', 'body'],
    onChange: vi.fn(),
    ...overrides,
  };
  const ctx = makeCtx<RenderItemFormSidebarPanelCtx>();
  const result = renderWithCanvas(<ModelFieldPicker {...props} />, ctx);
  return { props, ctx, ...result };
}

const fieldSelect = () =>
  screen.getByRole('combobox', { name: 'Fields of Articles' });

// react-select hides the input of a disabled select (visibility: hidden), so
// it has no accessible role: find it through its label.
const disabledFieldSelect = () => screen.getByLabelText('Fields of Articles');

/** Opens the menu of the field select and picks the option with `name`. */
function pick(name: string) {
  fireEvent.keyDown(fieldSelect(), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('ModelFieldPicker', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('labels the field with the model name and its api_key', () => {
    renderPicker();
    expect(fieldSelect()).toBeTruthy();
  });

  it('treats not-yet-loaded fields as pending, not as the dead end', () => {
    const { container } = renderPicker({ fields: undefined });
    expect(screen.getByText('Pick fields')).toBeTruthy();
    expect(container.querySelector('.SelectInput__loading')).not.toBeNull();
    expect(disabledFieldSelect()).toBeDisabled();
    expect(screen.queryByText(/translatable field/)).toBeNull();
    expect(screen.queryByText('No translatable fields')).toBeNull();
  });

  it('shows the pending select while loading', () => {
    renderPicker({ isLoading: true });
    expect(screen.getByText('Pick fields')).toBeTruthy();
    expect(disabledFieldSelect()).toBeDisabled();
  });

  it('shows the failed state whose "Try again" calls onRetry', () => {
    const onRetry = vi.fn();
    const { container } = renderPicker({
      fields: undefined,
      loadFailed: true,
      onRetry,
    });
    expect(screen.getByText('Fields of Articles')).toBeTruthy();
    // No select without fields: the field holds an error blank slate, in a
    // group that the label names, with "Try again" in view (not revealed on
    // hover like the actions of an empty slot).
    const group = screen.getByRole('group', { name: 'Fields of Articles' });
    expect(group).toHaveTextContent("Couldn't load the fields of this model");
    expect(group.querySelector('.blank-slate--section')).not.toBeNull();
    expect(container.querySelector('.EmptySlot')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    // The title says what failed: no field error repeats it.
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the focus through "Try again", then gives it to what loaded', () => {
    const onRetry = vi.fn();
    const { props, rerender } = renderPicker({
      fields: undefined,
      loadFailed: true,
      onRetry,
    });
    const loading = (
      <ModelFieldPicker {...props} isLoading loadFailed={false} />
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    act(() => retry.focus());
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // While the fields load, the box of the field holds the focus.
    rerender(loading);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(disabledFieldSelect());

    // The load fails again: the new "Try again" takes the focus.
    rerender(<ModelFieldPicker {...props} />);
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(again);

    // The next retry loads the fields: the field select takes the focus.
    fireEvent.click(again);
    rerender(loading);
    const holder = document.activeElement;
    expect(holder).toHaveAttribute('tabindex', '-1');
    rerender(
      <ModelFieldPicker {...props} fields={fields} loadFailed={false} />,
    );
    expect(document.activeElement).toBe(fieldSelect());
    // The box is no stop of the tab order once it lets the focus go.
    expect(holder).not.toHaveAttribute('tabindex');
  });

  it('gives the focus to "Remove model" when a retry finds no fields', () => {
    const { props, rerender } = renderPicker({
      fields: undefined,
      loadFailed: true,
      onRetry: vi.fn(),
      onRemove: vi.fn(),
    });
    const retry = screen.getByRole('button', { name: 'Try again' });
    act(() => retry.focus());
    fireEvent.click(retry);
    rerender(<ModelFieldPicker {...props} isLoading loadFailed={false} />);
    rerender(<ModelFieldPicker {...props} fields={[]} loadFailed={false} />);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Remove model' }),
    );
  });

  it('shows no "Try again" without onRetry', () => {
    renderPicker({ fields: undefined, loadFailed: true });
    expect(
      screen.getByText("Couldn't load the fields of this model"),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('locks "Try again" while disabled', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const onRetry = vi.fn();
    renderPicker({
      fields: undefined,
      loadFailed: true,
      onRetry,
      isDisabled: true,
    });
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    act(() => retry.focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Wait for the translation to start.',
    );
    // The tooltip of the reason clones the button: it takes no ref, which
    // React 19 would warn about.
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('element.ref'),
    );
  });

  it('shows "Remove model" in the dead end only with onRemove', () => {
    const onRemove = vi.fn();
    renderPicker({ fields: [], onRemove });
    expect(screen.getByText('No translatable fields')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    // "Remove model" is the other way out: the hint doesn't say it again.
    expect(screen.getByText(/Allow more field types in the/).textContent).toBe(
      'Allow more field types in the plugin settings.',
    );
    expect(
      screen.getByRole('group', { name: 'Fields of Articles' }),
    ).toHaveAccessibleDescription(
      'Allow more field types in the plugin settings.',
    );
    // The way out is in view, not an action revealed by the slot on hover.
    expect(
      screen.getByText('No translatable fields').closest('.form__field')
        ?.lastElementChild,
    ).toBe(screen.getByRole('button', { name: 'Remove model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove model' }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    // Without onRemove (the records picker) nor the path of the settings,
    // the role can't open them: it asks an admin.
    cleanup();
    renderPicker({ fields: [] });
    expect(screen.getByText('No translatable fields')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove model' })).toBeNull();
    expect(
      screen.getByRole('group', { name: 'Fields of Articles' }),
    ).toHaveAccessibleDescription(
      'Ask an admin to allow more field types, or leave these records out of the selection.',
    );
  });

  it('locks "Remove model" while disabled', () => {
    const consoleError = vi.spyOn(console, 'error');
    const onRemove = vi.fn();
    renderPicker({ fields: [], onRemove, isDisabled: true });
    const remove = screen.getByRole('button', { name: 'Remove model' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('element.ref'),
    );
  });

  it('links "plugin settings" in the dead end only with pluginSettingsPath', () => {
    const { ctx } = renderPicker({
      fields: [],
      onRemove: vi.fn(),
      pluginSettingsPath: '/configuration/plugins/plugin-id/edit',
    });
    fireEvent.click(screen.getByRole('link', { name: 'plugin settings' }));
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-id/edit',
    );

    // In the records picker, a dialog, the link opens a new tab.
    cleanup();
    renderPicker({
      fields: [],
      pluginSettingsPath: '/configuration/plugins/plugin-id/edit',
    });
    expect(
      screen.getByRole('link', { name: 'plugin settings' }),
    ).toHaveAttribute('target', '_blank');
    expect(
      screen.getByRole('group', { name: 'Fields of Articles' }),
    ).toHaveAccessibleDescription(
      'Allow more field types in the plugin settings, or leave these records out of the selection.',
    );

    cleanup();
    renderPicker({ fields: [], onRemove: vi.fn() });
    expect(screen.queryByRole('link', { name: 'plugin settings' })).toBeNull();
  });

  it('collapses a full selection to the "All fields" sentinel', () => {
    renderPicker();
    expect(screen.getByText('All fields')).toBeTruthy();
    expect(screen.queryByText('Title')).toBeNull();
    // "All fields" says it all: no count repeats it.
    expect(screen.queryByText(/translatable fields? selected/)).toBeNull();
  });

  it('narrows to the concrete picks when the sentinel is dropped', () => {
    const { props } = renderPicker({ selectedApiKeys: ['title'] });
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.queryByText('All fields')).toBeNull();
    expect(
      screen.getByText('1 of 2 translatable fields selected.'),
    ).toBeTruthy();
    pick('Body body');
    expect(props.onChange).toHaveBeenLastCalledWith(['title', 'body']);
  });

  it('expands the sentinel to every field when picked', () => {
    const { props } = renderPicker({ selectedApiKeys: ['title'] });
    pick('All fields');
    expect(props.onChange).toHaveBeenLastCalledWith(['title', 'body']);
  });

  it('narrows to a single field picked while "All fields" is active', () => {
    const { props } = renderPicker();
    pick('Title title');
    expect(props.onChange).toHaveBeenLastCalledWith(['title']);
  });

  it('hides the hint while a validation message shows', () => {
    renderPicker({
      selectedApiKeys: [],
      validationMessage: 'Pick at least one field',
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Pick at least one field',
    );
    expect(fieldSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/translatable field/)).toBeNull();
  });
});
