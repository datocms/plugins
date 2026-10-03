import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SelectField } from 'datocms-react-ui';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChipOption } from './chipOption';
import { useBoundedChipSelect } from './useBoundedChipSelect';

// The global setup mocks UI primitives; this integration verifies the real select.
vi.unmock('datocms-react-ui');
vi.hoisted(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const options: ChipOption[] = Array.from({ length: 1000 }, (_, index) => ({
  label: `Model ${index}`,
  value: `${index}`,
  code: `api_key_${index}`,
}));

function LargeSelect() {
  const [selected, setSelected] = useState<ChipOption[]>(options.slice(0, 200));
  const bounded = useBoundedChipSelect(options, selected, 'models');
  return (
    <>
      <SelectField
        id="models"
        name="models"
        label="Models"
        value={selected}
        placeholder={bounded.placeholder('Select models…')}
        onChange={(next) => setSelected(Array.isArray(next) ? [...next] : [])}
        selectInputProps={{ isMulti: true, ...bounded.selectProps }}
      />
      <output data-testid="selection-count">{selected.length}</output>
      <output data-testid="last-selected">
        {String(selected.some((option) => option.value === '199'))}
      </output>
    </>
  );
}

describe('bounded select with the actual UI kit', () => {
  afterEach(cleanup);

  it('shows the compact count and permits finding and removing any selected entry', () => {
    render(<LargeSelect />);
    expect(screen.getByText('200 models selected')).toBeTruthy();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'api_key_199' } });
    fireEvent.click(screen.getByText('Model 199'));
    expect(screen.getByTestId('selection-count').textContent).toBe('199');
    expect(screen.getByTestId('last-selected').textContent).toBe('false');
    expect(screen.getByText('199 models selected')).toBeTruthy();
  });
});
