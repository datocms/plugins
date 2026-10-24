import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithCanvas } from '../../test/renderWithCanvas';
import { useModelPickerPage } from './useModelPickerPage';

function Pickers({ models, compact }: { models: string[]; compact?: boolean }) {
  const { visibleModels, pagination } = useModelPickerPage(models, {
    compact,
  });
  return (
    <div>
      {pagination}
      {visibleModels.map((model) => (
        <div key={model} data-testid="model">
          {model}
        </div>
      ))}
    </div>
  );
}

const shownModels = () =>
  screen.getAllByTestId('model').map((model) => model.textContent);

describe('model picker pages', () => {
  afterEach(cleanup);

  it('preserves the complete original layout for 50 or fewer models', () => {
    renderWithCanvas(
      <Pickers models={Array.from({ length: 50 }, (_, index) => `${index}`)} />,
    );
    expect(screen.getAllByTestId('model')).toHaveLength(50);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('bounds field picker rows and allows inspecting all selected models without altering the job', () => {
    const models = Array.from({ length: 1001 }, (_, index) => `${index}`);
    const { rerender } = renderWithCanvas(<Pickers models={models} />);
    expect(
      screen.getByRole('navigation', { name: 'Selected models pagination' }),
    ).toBeTruthy();
    expect(screen.getAllByTestId('model')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(shownModels()[0]).toBe('50');
    expect(screen.getAllByTestId('model')).toHaveLength(50);
    expect(models).toHaveLength(1001);

    rerender(<Pickers models={models.slice(0, 51)} />);
    expect(shownModels()).toEqual(['50']);
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty(
      'disabled',
      true,
    );

    rerender(<Pickers models={models.slice(0, 3)} />);
    expect(screen.getAllByTestId('model')).toHaveLength(3);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('pages the pickers in a narrow place with the compact pagination', () => {
    const models = Array.from({ length: 120 }, (_, index) => `${index}`);
    renderWithCanvas(<Pickers models={models} compact />);
    expect(
      screen.getByRole('navigation', { name: 'Selected models pagination' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(shownModels()[0]).toBe('50');
  });

  it('clamps to the last page when the selection shrinks', () => {
    const models = Array.from({ length: 1001 }, (_, index) => `${index}`);
    const { rerender } = renderWithCanvas(<Pickers models={models} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }));
    expect(shownModels()[0]).toBe('100');

    rerender(<Pickers models={models.slice(0, 60)} />);
    expect(shownModels()).toEqual(models.slice(50, 60));
    expect(
      screen.getByRole('button', { name: 'Go to page 2' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});
