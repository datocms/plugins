import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkflowStageModal from './WorkflowStageModal';

function buildCtx(parameters: Record<string, unknown>) {
  const resolve = vi.fn(async (_value: unknown) => {});
  const ctx = {
    mode: 'renderModal',
    parameters,
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    ui: { locale: 'en' },
    site: { attributes: { internal_domain: null } },
    navigateTo: vi.fn(),
    notice: vi.fn(),
    alert: vi.fn(),
    customToast: vi.fn(),
    openConfirm: vi.fn(),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
    resolve,
  } as unknown as RenderModalCtx;
  return { ctx, resolve };
}

const STAGES = [
  { id: 'stage-review', name: 'Review' },
  { id: 'stage-draft', name: 'Draft' },
];

afterEach(() => {
  cleanup();
});

describe('WorkflowStageModal', () => {
  it('preselects the first stage and resolves the chosen one', () => {
    const { ctx, resolve } = buildCtx({ count: 3, stages: STAGES });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(
      screen.getByText('The 3 selected records move to this stage.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Review' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('stage-draft');
  });

  it('resolves null on Cancel', () => {
    const { ctx, resolve } = buildCtx({ count: 1, stages: STAGES });
    render(<WorkflowStageModal ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resolve).toHaveBeenCalledWith(null);
  });

  it('names a single stage instead of offering one radio', () => {
    const { ctx, resolve } = buildCtx({
      count: 3,
      stages: [{ id: 'stage-review', name: 'Review' }],
    });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByText('The 3 selected records move to the stage “Review”.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('stage-review');
  });

  it('picks from a select with more than five stages', () => {
    const stages = Array.from({ length: 6 }, (_, index) => ({
      id: `stage-${index}`,
      name: `Stage ${index}`,
    }));
    const { ctx, resolve } = buildCtx({ count: 1, stages });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByText('The selected record moves to this stage.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('stage-0');
  });

  it('offers only Cancel without valid stages', () => {
    const { ctx } = buildCtx({ count: 2, stages: [{ id: 1 }] });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(screen.getByText('No stages to move to')).toBeInTheDocument();
    expect(
      screen.getByText('Close this dialog, then choose Move to stage again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue' }),
    ).not.toBeInTheDocument();
  });
});
