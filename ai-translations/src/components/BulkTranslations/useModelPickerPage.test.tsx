import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelPickerPage } from './useModelPickerPage';

function Pickers({ models }: { models: string[] }) {
  const { visibleModels, controls } = useModelPickerPage(models);
  return (
    <div>
      {controls}
      {visibleModels.map((model) => (
        <div key={model} data-testid="model">
          {model}
        </div>
      ))}
    </div>
  );
}

describe('model picker pages', () => {
  afterEach(cleanup);

  it('preserves the complete original layout for 50 or fewer models', () => {
    render(
      <Pickers models={Array.from({ length: 50 }, (_, index) => `${index}`)} />,
    );
    expect(screen.getAllByTestId('model')).toHaveLength(50);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('bounds field picker rows and allows inspecting all selected models without altering the job', () => {
    const models = Array.from({ length: 1001 }, (_, index) => `${index}`);
    const { rerender } = render(<Pickers models={models} />);
    expect(screen.getAllByTestId('model')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Next models' }));
    expect(screen.getAllByTestId('model')[0].textContent).toBe('50');
    expect(screen.getAllByTestId('model')).toHaveLength(50);
    expect(models).toHaveLength(1001);
    rerender(<Pickers models={models.slice(0, 51)} />);
    expect(screen.getAllByTestId('model')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next models' })).toHaveProperty(
      'disabled',
      true,
    );
    rerender(<Pickers models={models.slice(0, 3)} />);
    expect(screen.getAllByTestId('model')).toHaveLength(3);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
