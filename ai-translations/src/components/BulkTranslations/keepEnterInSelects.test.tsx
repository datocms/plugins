import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { keepEnterInSelects } from './keepEnterInSelects';

function renderForm() {
  render(
    <form onKeyDown={keepEnterInSelects}>
      <input role="combobox" aria-label="Models" aria-expanded={false} />
      <input aria-label="Name" />
      <button type="submit">Start</button>
    </form>,
  );
}

describe('keepEnterInSelects', () => {
  afterEach(cleanup);

  it('prevents the implicit submission of Enter in a select', () => {
    renderForm();
    const select = screen.getByRole('combobox', { name: 'Models' });

    expect(fireEvent.keyDown(select, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(select, { key: 'ArrowDown' })).toBe(true);
  });

  it('leaves Enter alone everywhere else', () => {
    renderForm();

    expect(
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), {
        key: 'Enter',
      }),
    ).toBe(true);
    expect(
      fireEvent.keyDown(screen.getByRole('button', { name: 'Start' }), {
        key: 'Enter',
      }),
    ).toBe(true);
  });
});
