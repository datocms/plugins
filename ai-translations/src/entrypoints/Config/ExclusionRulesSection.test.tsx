import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getChipRemoveButton,
  renderWithCanvas,
} from '../../test/renderWithCanvas';
import ExclusionRulesSection, {
  type ExclusionRulesSectionProps,
  type Field,
} from './ExclusionRulesSection';

const fields: Field[] = [
  { id: 'field-season', name: 'Season type', model: 'Season block' },
  { id: 'field-title', name: 'Title', model: 'Article' },
];

function createProps(
  overrides: Partial<ExclusionRulesSectionProps> = {},
): ExclusionRulesSectionProps {
  return {
    showExclusionRules: true,
    setShowExclusionRules: vi.fn(),
    hasExclusionRules: true,
    modelsToBeExcluded: [],
    setModelsToBeExcluded: vi.fn(),
    rolesToBeExcluded: [],
    setRolesToBeExcluded: vi.fn(),
    apiKeysToBeExcluded: [],
    setApiKeysToBeExcluded: vi.fn(),
    availableModels: [],
    roles: [],
    listOfFields: fields,
    ...overrides,
  };
}

function selectedFieldValues(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[name="apiKeysToBeExcludedFromTranslation"]',
    ),
    (input) => input.value,
  );
}

/** Whether the "Excluded fields" select shows its loading indicator. */
function fieldsSelectLoading(container: HTMLElement): boolean {
  const input = container.querySelector(
    'input[name="apiKeysToBeExcludedFromTranslation"]',
  );
  const select = input?.closest('.SelectInput');
  return Boolean(select?.querySelector('.SelectInput__loading'));
}

describe('ExclusionRulesSection', () => {
  it('resolves saved IDs and keeps API keys, paths, and unknown fields readable', () => {
    const saved = [
      'field-season',
      'season_type',
      'hero.season_type',
      'deleted-field',
    ];
    const { container } = renderWithCanvas(
      <ExclusionRulesSection
        {...createProps({ apiKeysToBeExcluded: saved })}
      />,
    );

    expect(screen.getByText('Season type (Season block)')).toBeInTheDocument();
    expect(screen.getByText('season_type')).toBeInTheDocument();
    expect(screen.getByText('hero.season_type')).toBeInTheDocument();
    expect(screen.getByText('deleted-field')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(selectedFieldValues(container)).toEqual(saved);
  });

  it('preserves saved tokens while field metadata loads and refreshes ID labels', () => {
    const saved = ['field-season', 'season_type', 'hero.season_type'];
    const props = createProps({
      apiKeysToBeExcluded: saved,
      listOfFields: [],
      fieldsLoading: true,
    });
    const { container, rerender } = renderWithCanvas(
      <ExclusionRulesSection {...props} />,
    );

    for (const token of saved) {
      expect(screen.getByText(token)).toBeInTheDocument();
    }
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(selectedFieldValues(container)).toEqual(saved);
    // The select says that its labels are still loading
    expect(fieldsSelectLoading(container)).toBe(true);

    rerender(
      <ExclusionRulesSection
        {...props}
        listOfFields={fields}
        fieldsLoading={false}
      />,
    );
    expect(fieldsSelectLoading(container)).toBe(false);

    expect(screen.getByText('Season type (Season block)')).toBeInTheDocument();
    expect(screen.getByText('season_type')).toBeInTheDocument();
    expect(screen.getByText('hero.season_type')).toBeInTheDocument();
    expect(selectedFieldValues(container)).toEqual(saved);
    expect(props.setApiKeysToBeExcluded).not.toHaveBeenCalled();
  });

  it('adds selected field IDs without replacing saved API keys or paths', () => {
    const saved = ['season_type', 'hero.season_type', 'deleted-field'];
    const props = createProps({ apiKeysToBeExcluded: saved });
    renderWithCanvas(<ExclusionRulesSection {...props} />);

    const input = screen.getByRole('combobox', { name: 'Excluded fields' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Title (Article)' }));

    expect(props.setApiKeysToBeExcluded).toHaveBeenCalledWith([
      ...saved,
      'field-title',
    ]);
  });

  it('removes a saved token without changing the remaining exclusion values', () => {
    const props = createProps({
      apiKeysToBeExcluded: [
        'field-season',
        'season_type',
        'hero.season_type',
        'deleted-field',
      ],
    });
    renderWithCanvas(<ExclusionRulesSection {...props} />);

    fireEvent.click(getChipRemoveButton('season_type'));

    expect(props.setApiKeysToBeExcluded).toHaveBeenCalledWith([
      'field-season',
      'hero.season_type',
      'deleted-field',
    ]);
  });

  it('names excluded models with their API key and keeps a deleted model readable', () => {
    renderWithCanvas(
      <ExclusionRulesSection
        {...createProps({
          availableModels: [{ apiKey: 'article', name: 'Article' }],
          modelsToBeExcluded: ['article', 'deleted_model'],
        })}
      />,
    );

    expect(screen.getByText('Article')).toBeInTheDocument();
    expect(screen.getByText('article')).toBeInTheDocument();
    expect(screen.getByText('deleted_model')).toBeInTheDocument();
  });

  it('tells that exclusions exist, and closes the group on its title', () => {
    const props = createProps();
    renderWithCanvas(<ExclusionRulesSection {...props} />);

    expect(screen.getByText(/doesn't show everywhere/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exclusions' }));

    expect(props.setShowExclusionRules).toHaveBeenCalledWith(false);
  });

  it('shows only the title of a closed group, with no callout without exclusions', () => {
    renderWithCanvas(
      <ExclusionRulesSection
        {...createProps({
          showExclusionRules: false,
          hasExclusionRules: false,
        })}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Exclusions' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/doesn't show everywhere/),
    ).not.toBeInTheDocument();
  });

  it('keeps saying in the header of a closed group that exclusions exist', () => {
    renderWithCanvas(
      <ExclusionRulesSection
        {...createProps({
          showExclusionRules: false,
          modelsToBeExcluded: ['article'],
          rolesToBeExcluded: ['role-1'],
        })}
      />,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('2 exclusions')).toBeInTheDocument();
  });

  it('shows the roles while they load, and the failure of their request', () => {
    const { rerender } = renderWithCanvas(
      <ExclusionRulesSection
        {...createProps({
          rolesToBeExcluded: ['role-1'],
          rolesStatus: 'loading',
        })}
      />,
    );
    expect(screen.getByText('role-1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <ExclusionRulesSection
        {...createProps({
          rolesToBeExcluded: ['role-1'],
          rolesStatus: 'error',
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't load the roles.",
    );

    rerender(
      <ExclusionRulesSection
        {...createProps({
          roles: [{ id: 'role-1', name: 'Editor' }],
          rolesToBeExcluded: ['role-1'],
          rolesStatus: 'ready',
        })}
      />,
    );
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
