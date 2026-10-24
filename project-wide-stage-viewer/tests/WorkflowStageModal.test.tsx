import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import WorkflowStageModal from '../src/entrypoints/WorkflowStageModal';

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
  { id: 'review', name: 'In review' },
  { id: 'legal', name: 'Legal check' },
];

describe('WorkflowStageModal', () => {
  it('preselects the first stage and resolves its id', () => {
    const { ctx, resolve } = buildCtx({ count: 3, stages: STAGES });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(
      screen.getByText('The 3 selected records move to this stage.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'In review' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('review');
  });

  it('resolves the stage that the user picks', () => {
    const { ctx, resolve } = buildCtx({ count: 1, stages: STAGES });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(
      screen.getByText('The selected record moves to this stage.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Legal check' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('legal');
  });

  it('resolves null on Cancel', () => {
    const { ctx, resolve } = buildCtx({ count: 1, stages: STAGES });
    render(<WorkflowStageModal ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resolve).toHaveBeenCalledWith(null);
  });

  it('names a single stage instead of offering one radio', () => {
    const { ctx, resolve } = buildCtx({
      count: 2,
      stages: [{ id: 'review', name: 'In review' }],
    });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByText('The 2 selected records move to the stage “In review”.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('review');
  });

  it('picks from a select with more than five stages', () => {
    const stages = Array.from({ length: 6 }, (_, index) => ({
      id: `stage-${index}`,
      name: `Stage ${index}`,
    }));
    const { ctx, resolve } = buildCtx({ count: 4, stages });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Stage 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(resolve).toHaveBeenCalledWith('stage-0');
  });

  it('offers only Cancel without valid stages', () => {
    const { ctx, resolve } = buildCtx({ count: 2, stages: [{ id: 1 }] });
    render(<WorkflowStageModal ctx={ctx} />);

    expect(screen.getByText('No stages to move to')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resolve).toHaveBeenCalledWith(null);
  });
});
