import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FieldConfigScreen from './FieldConfigScreen';

afterEach(cleanup);

vi.mock('datocms-react-ui', () => {
  type Option = { value: string; label: string };

  return {
    Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectField: ({
      id,
      label,
      value,
      onChange,
      error,
      selectInputProps,
    }: {
      id: string;
      label: ReactNode;
      value: Option | null | undefined;
      onChange: (value: Option | null) => void;
      error?: ReactNode;
      selectInputProps?: { options?: readonly Option[] };
    }) => (
      <div>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value?.value ?? ''}
          onChange={(event) =>
            onChange(
              selectInputProps?.options?.find(
                (option) => option.value === event.target.value,
              ) ?? null,
            )
          }
        >
          {selectInputProps?.options?.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <span>{error}</span>}
      </div>
    ),
  };
});

function createCtx({
  parameters = {},
  fieldType = 'json',
  errors = {},
}: {
  parameters?: Record<string, unknown>;
  fieldType?: string;
  errors?: Record<string, unknown>;
} = {}) {
  const setParameters = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    parameters,
    errors,
    pendingField: { attributes: { field_type: fieldType } },
    setParameters,
  } as unknown as RenderManualFieldExtensionConfigScreenCtx;

  return { ctx, setParameters };
}

describe('FieldConfigScreen', () => {
  it('writes a complete versioned payload when reference type changes', () => {
    const { ctx, setParameters } = createCtx();
    render(<FieldConfigScreen ctx={ctx} />);

    expect(screen.getByLabelText('Select')).toHaveValue('primaryProduct');
    expect(screen.getByLabelText('Allow')).toHaveValue('single');
    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    });
    setParameters.mockClear();

    fireEvent.change(screen.getByLabelText('Select'), {
      target: { value: 'item' },
    });

    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'item',
      cardinality: 'single',
    });
  });

  it('preserves the selected kind when cardinality changes', () => {
    const { ctx, setParameters } = createCtx({
      parameters: {
        paramsVersion: '1',
        kind: 'variant',
        cardinality: 'single',
      },
    });
    render(<FieldConfigScreen ctx={ctx} />);

    fireEvent.change(screen.getByLabelText('Allow'), {
      target: { value: 'multiple' },
    });

    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });
  });

  it('shows SDK validation errors next to their controls', () => {
    const { ctx } = createCtx({
      errors: {
        kind: 'Choose a reference type.',
        cardinality: 'Choose a selection mode.',
      },
    });
    render(<FieldConfigScreen ctx={ctx} />);

    expect(screen.getByText('Choose a reference type.')).toBeInTheDocument();
    expect(screen.getByText('Choose a selection mode.')).toBeInTheDocument();
  });

  it('preserves unsupported field settings until the user changes them', () => {
    const { ctx, setParameters } = createCtx({
      parameters: {
        paramsVersion: '2',
        kind: 'variant',
        cardinality: 'multiple',
      },
    });
    render(<FieldConfigScreen ctx={ctx} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'saved Centra field settings use an unsupported version',
    );
    expect(setParameters).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Select'), {
      target: { value: 'item' },
    });

    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'item',
      cardinality: 'multiple',
    });
  });

  it('refuses configuration on non-JSON fields', () => {
    const { ctx, setParameters } = createCtx({ fieldType: 'string' });
    render(<FieldConfigScreen ctx={ctx} />);

    expect(
      screen.getByRole('alert', { name: '' }),
    ).toHaveTextContent('can only be installed on JSON fields');
    expect(setParameters).not.toHaveBeenCalled();
  });
});
