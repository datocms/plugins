import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranslatableField } from '../../utils/translation/BulkTranslationHelpers';
import type { ChipOption } from './chipOption';
import {
  ModelFieldPicker,
  type ModelFieldPickerProps,
} from './ModelFieldPicker';

type MockSelectFieldProps = {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  value: ChipOption[];
  onChange: (value: ChipOption[]) => void;
  selectInputProps: {
    options: ChipOption[];
    isLoading?: boolean;
    isDisabled?: boolean;
  };
};

vi.mock('datocms-react-ui', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  FieldWrapper: ({
    label,
    children,
  }: {
    label: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <div data-testid="label">{label}</div>
      {children}
    </div>
  ),
  SelectField: ({
    name,
    label,
    hint,
    error,
    placeholder,
    value,
    onChange,
    selectInputProps,
  }: MockSelectFieldProps) => (
    <div data-testid={`select-${name}`}>
      <div data-testid="label">{label}</div>
      <div data-testid="placeholder">{placeholder}</div>
      <div data-testid="value">{value.map((o) => o.label).join(', ')}</div>
      {hint && <div data-testid="hint">{hint}</div>}
      {error && <div data-testid="error">{error}</div>}
      {selectInputProps.isLoading && <div data-testid="loading" />}
      {selectInputProps.isDisabled && <div data-testid="disabled" />}
      {selectInputProps.options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange([...value, option])}
        >
          {`pick ${option.label}`}
        </button>
      ))}
      <button type="button" onClick={() => onChange(value.slice(1))}>
        remove first
      </button>
    </div>
  ),
}));

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
  render(<ModelFieldPicker {...props} />);
  return props;
}

describe('ModelFieldPicker', () => {
  afterEach(cleanup);

  it('labels the field with the model name and its api_key', () => {
    renderPicker();
    expect(screen.getByTestId('label').textContent).toBe('Articles article');
  });

  it('treats not-yet-loaded fields as pending, not as the dead end', () => {
    renderPicker({ fields: undefined });
    expect(screen.getByTestId('placeholder').textContent).toBe(
      'Loading fields…',
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.getByTestId('disabled')).toBeTruthy();
    expect(screen.queryByTestId('hint')).toBeNull();
    expect(
      screen.queryByText(/This model has no fields the plugin can translate/),
    ).toBeNull();
  });

  it('shows the pending select while loading', () => {
    renderPicker({ isLoading: true });
    expect(screen.getByTestId('placeholder').textContent).toBe(
      'Loading fields…',
    );
  });

  it('shows a failure row whose "Try again" calls onRetry', () => {
    const onRetry = vi.fn();
    renderPicker({ fields: undefined, loadFailed: true, onRetry });
    expect(
      screen.getByText("Couldn't load the fields of this model"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('locks "Try again" while disabled', () => {
    renderPicker({
      fields: undefined,
      loadFailed: true,
      onRetry: vi.fn(),
      isDisabled: true,
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows "Remove model" in the dead end only with onRemove', () => {
    const onRemove = vi.fn();
    renderPicker({ fields: [], onRemove });
    expect(
      screen.getByText(/This model has no fields the plugin can translate/)
        .textContent,
    ).toContain('or remove the model.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove model' }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    cleanup();
    renderPicker({ fields: [] });
    expect(screen.queryByRole('button', { name: 'Remove model' })).toBeNull();
    expect(
      screen.getByText(/This model has no fields the plugin can translate/)
        .textContent,
    ).toBe(
      'This model has no fields the plugin can translate. Allow more field types in the plugin settings, or leave its records out of the selection.',
    );
  });

  it('links "plugin settings" in the dead end only with onOpenPluginSettings', () => {
    const onOpenPluginSettings = vi.fn();
    renderPicker({ fields: [], onOpenPluginSettings });
    fireEvent.click(screen.getByRole('button', { name: 'plugin settings' }));
    expect(onOpenPluginSettings).toHaveBeenCalledTimes(1);

    cleanup();
    renderPicker({ fields: [] });
    expect(
      screen.queryByRole('button', { name: 'plugin settings' }),
    ).toBeNull();
  });

  it('collapses a full selection to the "All fields" sentinel', () => {
    renderPicker();
    expect(screen.getByTestId('value').textContent).toBe('All fields');
    expect(screen.getByTestId('hint').textContent).toBe(
      '2 of 2 translatable fields selected',
    );
  });

  it('narrows to the concrete picks when the sentinel is dropped', () => {
    const props = renderPicker({ selectedApiKeys: ['title'] });
    expect(screen.getByTestId('value').textContent).toBe('Title');
    fireEvent.click(screen.getByRole('button', { name: 'pick Body' }));
    expect(props.onChange).toHaveBeenLastCalledWith(['title', 'body']);
  });

  it('expands the sentinel to every field when picked', () => {
    const props = renderPicker({ selectedApiKeys: ['title'] });
    fireEvent.click(screen.getByRole('button', { name: 'pick All fields' }));
    expect(props.onChange).toHaveBeenLastCalledWith(['title', 'body']);
  });

  it('narrows to a single field picked while "All fields" is active', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'pick Title' }));
    expect(props.onChange).toHaveBeenLastCalledWith(['title']);
  });

  it('hides the hint while a validation message shows', () => {
    renderPicker({
      selectedApiKeys: [],
      validationMessage: 'Field is required',
    });
    expect(screen.getByTestId('error').textContent).toBe('Field is required');
    expect(screen.queryByTestId('hint')).toBeNull();
  });
});
