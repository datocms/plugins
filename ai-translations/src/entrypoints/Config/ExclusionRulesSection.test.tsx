import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExclusionRulesSection, {
  type ExclusionRulesSectionProps,
  type Field,
} from './ExclusionRulesSection';

vi.unmock('datocms-react-ui');
vi.hoisted(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

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

describe('ExclusionRulesSection', () => {
  it('resolves saved IDs and keeps API keys, paths, and unknown fields readable', () => {
    const saved = [
      'field-season',
      'season_type',
      'hero.season_type',
      'deleted-field',
    ];
    const { container } = render(
      <ExclusionRulesSection {...createProps({ apiKeysToBeExcluded: saved })} />,
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
    const props = createProps({ apiKeysToBeExcluded: saved, listOfFields: [] });
    const { container, rerender } = render(<ExclusionRulesSection {...props} />);

    for (const token of saved) {
      expect(screen.getByText(token)).toBeInTheDocument();
    }
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(selectedFieldValues(container)).toEqual(saved);

    rerender(<ExclusionRulesSection {...props} listOfFields={fields} />);

    expect(screen.getByText('Season type (Season block)')).toBeInTheDocument();
    expect(screen.getByText('season_type')).toBeInTheDocument();
    expect(screen.getByText('hero.season_type')).toBeInTheDocument();
    expect(selectedFieldValues(container)).toEqual(saved);
    expect(props.setApiKeysToBeExcluded).not.toHaveBeenCalled();
  });

  it('adds selected field IDs without replacing saved API keys or paths', () => {
    const saved = ['season_type', 'hero.season_type', 'deleted-field'];
    const props = createProps({ apiKeysToBeExcluded: saved });
    render(<ExclusionRulesSection {...props} />);

    const input = screen.getAllByRole('combobox')[2];
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
    render(<ExclusionRulesSection {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove season_type' }));

    expect(props.setApiKeysToBeExcluded).toHaveBeenCalledWith([
      'field-season',
      'hero.season_type',
      'deleted-field',
    ]);
  });
});
