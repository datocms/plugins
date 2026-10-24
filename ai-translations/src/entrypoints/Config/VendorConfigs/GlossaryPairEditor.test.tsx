import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithCanvas } from '../../../test/renderWithCanvas';
import GlossaryPairEditor, {
  parseRows,
  serializeRows,
} from './GlossaryPairEditor';
import type { DeepLGlossary } from './useDeepLGlossaries';

const GLOSSARIES: DeepLGlossary[] = [
  {
    glossary_id: 'g-1',
    name: 'Marketing',
    ready: true,
    source_lang: 'en',
    target_lang: 'it',
    entry_count: 12,
  },
];

function editor(
  value: string,
  onChange: (value: string) => void,
  openConfirm: () => Promise<unknown>,
) {
  return (
    <GlossaryPairEditor
      value={value}
      onChange={onChange}
      siteLocales={['en', 'it']}
      glossaries={GLOSSARIES}
      fetchStatus="success"
      openConfirm={openConfirm}
    />
  );
}

function renderEditor(value: string, confirmed = true) {
  const onChange = vi.fn();
  const openConfirm = vi.fn().mockResolvedValue(confirmed);
  const { rerender } = renderWithCanvas(editor(value, onChange, openConfirm));
  return {
    onChange,
    openConfirm,
    rerender: (next: string) => rerender(editor(next, onChange, openConfirm)),
  };
}

/** The config screen keeps the stored string: it passes it back. */
function StatefulEditor({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('');
  return editor(
    value,
    (next) => {
      setValue(next);
      onChange(next);
    },
    vi.fn(),
  );
}

/** Opens the menu of the select cell `name` of a row and picks `option`. */
function pick(name: string, option: string, row = 0) {
  fireEvent.keyDown(screen.getAllByRole('combobox', { name })[row], {
    key: 'ArrowDown',
  });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('parseRows and serializeRows', () => {
  it('read every accepted separator and write one line per complete row', () => {
    const rows = parseRows('en->it=g-1; it → * : g-2\n*->en=g-3');

    expect(rows).toEqual([
      { source: 'en', target: 'it', glossaryId: 'g-1' },
      { source: 'it', target: '*', glossaryId: 'g-2' },
      { source: '*', target: 'en', glossaryId: 'g-3' },
    ]);
    expect(
      serializeRows([...rows, { source: 'en', target: '', glossaryId: '' }]),
    ).toBe('en->it=g-1\nit->*=g-2\n*->en=g-3');
  });
});

describe('GlossaryPairEditor', () => {
  it('shows the saved pairs with locale and glossary labels', () => {
    renderEditor('en->*=g-1');

    expect(
      screen.getByRole('group', { name: 'Glossaries by language pair' }),
    ).toBeInTheDocument();
    expect(screen.getByText('English [en]')).toBeInTheDocument();
    expect(screen.getByText('All (*)')).toBeInTheDocument();
    // The cell shows the name, the menu also the languages and the size
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Glossary' }), {
      key: 'ArrowDown',
    });
    expect(
      screen.getByRole('option', { name: 'Marketing (en→it, 12 entries)' }),
    ).toBeInTheDocument();
  });

  it('shows one error per kind for unknown locales and glossaries', () => {
    renderEditor('fr->de=g-1\nen->it=g-404');

    const errors = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(errors).toEqual([
      'Pick a locale of this project',
      'Pick a glossary of your DeepL account',
    ]);
    // The unknown values stay readable
    expect(screen.getByText('fr')).toBeInTheDocument();
    expect(screen.getByText('g-404')).toBeInTheDocument();
    // Each invalid cell is described by the message of its error
    const [fromCell] = screen.getAllByRole('combobox', { name: 'From' });
    expect(fromCell).toHaveAttribute('aria-invalid', 'true');
    expect(fromCell).toHaveAccessibleDescription(
      'Pick a locale of this project',
    );
    const [, glossaryCell] = screen.getAllByRole('combobox', {
      name: 'Glossary',
    });
    expect(glossaryCell).toHaveAccessibleDescription(
      'Pick a glossary of your DeepL account',
    );
  });

  it('asks before removing a filled row', async () => {
    const { onChange, openConfirm } = renderEditor('en->it=g-1\nit->en=g-1');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('it->en=g-1'));
    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove this language pair?',
        content:
          'From English [en] to Italian [it], with the glossary “Marketing”.',
      }),
    );
  });

  it('removes an empty row without asking', () => {
    const { onChange, openConfirm } = renderEditor('');

    expect(screen.getByText('No language pairs')).toBeInTheDocument();
    // The empty list is one button that adds the first row
    fireEvent.click(screen.getByRole('button', { name: /Add language pair$/ }));
    // An incomplete row stays in the editor but isn't saved
    expect(onChange).toHaveBeenLastCalledWith('');

    fireEvent.click(screen.getByRole('button', { name: 'Remove row' }));

    expect(openConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('No language pairs')).toBeInTheDocument();
  });

  it('keeps the row when the removal is cancelled', async () => {
    const { onChange, openConfirm } = renderEditor('en->it=g-1', false);

    fireEvent.click(screen.getByRole('button', { name: 'Remove row' }));

    await waitFor(() => expect(openConfirm).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('English [en]')).toBeInTheDocument();
  });

  it('keeps an incomplete row in the editor, and saves it once complete', () => {
    const onChange = vi.fn();
    renderWithCanvas(<StatefulEditor onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Add language pair$/ }));
    pick('From', 'English [en]');
    pick('To', 'Italian [it]');

    // Not saved yet, but still in the editor
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByText('English [en]')).toBeInTheDocument();
    expect(screen.getByText('Italian [it]')).toBeInTheDocument();

    pick('Glossary', 'Marketing (en→it, 12 entries)');

    expect(onChange).toHaveBeenLastCalledWith('en->it=g-1');
  });

  it('reads the rows again when the saved value changes elsewhere', () => {
    const { rerender } = renderEditor('en->it=g-1');

    // For example "Restore defaults", or the saved settings arriving
    rerender('it->*=g-1');

    expect(screen.queryByText('English [en]')).not.toBeInTheDocument();
    expect(screen.getByText('Italian [it]')).toBeInTheDocument();
    expect(screen.getByText('All (*)')).toBeInTheDocument();
  });
});
