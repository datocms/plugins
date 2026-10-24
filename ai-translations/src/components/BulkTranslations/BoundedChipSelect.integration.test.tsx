import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithCanvas } from '../../test/renderWithCanvas';
import { type ChipOption, formatApiKeyOptionLabel } from './chipOption';
import { useBoundedChipSelect } from './useBoundedChipSelect';

const options: ChipOption[] = Array.from({ length: 1000 }, (_, index) => ({
  label: `Model ${index}`,
  value: `${index}`,
  code: `api_key_${index}`,
}));

function LargeSelect() {
  const [selected, setSelected] = useState<string[]>(
    options.slice(0, 200).map((option) => option.value),
  );
  const bounded = useBoundedChipSelect(options, selected, 'models');
  return (
    <>
      <FieldWrapper label="Models">
        <SelectInput
          multiple
          {...bounded.selectProps}
          value={selected}
          placeholder={bounded.placeholder('Pick models')}
          onChange={(next) => setSelected(next ?? [])}
          formatOptionLabel={formatApiKeyOptionLabel}
        />
      </FieldWrapper>
      <output data-testid="selection-count">{selected.length}</output>
      <output data-testid="last-selected">
        {String(selected.includes('199'))}
      </output>
    </>
  );
}

describe('bounded select with the actual UI kit', () => {
  afterEach(cleanup);

  it('shows the compact count and permits finding and removing any selected entry', () => {
    renderWithCanvas(<LargeSelect />);
    expect(screen.getByText('200 models selected')).toBeTruthy();
    const input = screen.getByRole('combobox', { name: 'Models' });
    fireEvent.change(input, { target: { value: 'api_key_199' } });
    const option = screen.getByRole('option', {
      name: 'Model 199 api_key_199',
    });
    // The menu lists the selected match in its own group, for removal.
    expect(
      within(screen.getByRole('listbox')).getByText('Selected models'),
    ).toBeTruthy();
    fireEvent.click(option);
    expect(screen.getByTestId('selection-count').textContent).toBe('199');
    expect(screen.getByTestId('last-selected').textContent).toBe('false');
    expect(screen.getByText('199 models selected')).toBeTruthy();
  });
});
