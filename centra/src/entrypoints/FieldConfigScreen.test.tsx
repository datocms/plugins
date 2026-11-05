import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasCtx } from '../../tests/canvasCtx';
import FieldConfigScreen from './FieldConfigScreen';

afterEach(cleanup);

function createCtx({
  parameters = {},
  fieldType = 'json',
  errors = {},
}: {
  parameters?: Record<string, unknown>;
  fieldType?: string;
  errors?: Record<string, unknown>;
} = {}) {
  const setParameters = vi.fn(async () => undefined);
  const ctx = {
    ...canvasCtx(),
    mode: 'renderManualFieldExtensionConfigScreen',
    parameters,
    errors,
    pendingField: { attributes: { field_type: fieldType } },
    setParameters,
  } as unknown as RenderManualFieldExtensionConfigScreenCtx;

  return { ctx, setParameters };
}

// A kind option's name also holds its hint (the kit's label wraps both): match
// its start
function radio(name: string | RegExp) {
  return screen.getByRole('radio', { name });
}

describe('FieldConfigScreen', () => {
  it('writes a complete versioned payload when the kind changes', () => {
    const { ctx, setParameters } = createCtx();
    render(<FieldConfigScreen ctx={ctx} />);

    expect(
      screen.getByRole('radiogroup', { name: 'Editors pick' }),
    ).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'How many' })).toBeVisible();
    expect(radio(/^Products/)).toBeChecked();
    expect(radio('One')).toBeChecked();
    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    });
    setParameters.mockClear();

    fireEvent.click(radio(/^SKUs/));

    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'item',
      cardinality: 'single',
    });
    expect(radio(/^SKUs/)).toBeChecked();
  });

  it('writes the defaults only once for empty parameters', () => {
    const { ctx, setParameters } = createCtx();
    const { rerender } = render(<FieldConfigScreen ctx={ctx} />);

    rerender(<FieldConfigScreen ctx={{ ...ctx, parameters: {} }} />);

    expect(setParameters).toHaveBeenCalledOnce();
  });

  it('preserves the selected kind when the cardinality changes', () => {
    const { ctx, setParameters } = createCtx({
      parameters: {
        paramsVersion: '1',
        kind: 'variant',
        cardinality: 'single',
      },
    });
    render(<FieldConfigScreen ctx={ctx} />);

    expect(radio(/^Product variants/)).toBeChecked();
    expect(setParameters).not.toHaveBeenCalled();

    fireEvent.click(radio('Multiple'));

    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'variant',
      cardinality: 'multiple',
    });
  });

  it('shows SDK validation errors on their controls', () => {
    const { ctx } = createCtx({
      errors: {
        kind: 'Choose what editors pick.',
        cardinality: 'Choose how many items editors pick.',
      },
    });
    render(<FieldConfigScreen ctx={ctx} />);

    expect(screen.getByText('Choose what editors pick.')).toBeInTheDocument();
    expect(
      screen.getByText('Choose how many items editors pick.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'Editors pick' }),
    ).toHaveAccessibleDescription(/Choose what editors pick\./);
    expect(
      screen.getByRole('radiogroup', { name: 'How many' }),
    ).toHaveAccessibleDescription(/Choose how many items editors pick\./);
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

    // The kind of another version shows no option as chosen; the valid
    // cardinality stays chosen
    for (const option of screen.getAllByRole('radio').slice(0, 3)) {
      expect(option).not.toBeChecked();
    }
    expect(radio(/^Multiple/)).toBeChecked();
    expect(setParameters).not.toHaveBeenCalled();

    fireEvent.click(radio(/^SKUs/));

    expect(setParameters).toHaveBeenCalledWith({
      paramsVersion: '1',
      kind: 'item',
      cardinality: 'multiple',
    });
  });

  it('refuses configuration on non-JSON fields', () => {
    const { ctx, setParameters } = createCtx({ fieldType: 'string' });
    render(<FieldConfigScreen ctx={ctx} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The Centra editor works on JSON fields only.',
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(setParameters).not.toHaveBeenCalled();
  });
});
