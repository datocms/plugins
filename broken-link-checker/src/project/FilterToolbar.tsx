import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import Toolbar from 'datocms-react-ui/Toolbar';
import { localeName } from '../report/format';
import type { Filters, ReportDimensions } from '../report/view';
import styles from './Report.module.css';

type Choice = {
  value: string;
  label: string;
  /** More words the menu's search finds: a locale's code ("it", "en-US"). */
  keywords?: string[];
};

type ChoiceMenuProps = {
  /** The label of the trigger and of the first choice when nothing is picked. */
  allLabel: string;
  choices: readonly Choice[];
  /** `''` is the first choice: every model, every locale. */
  value: string;
  onChange: (value: string) => void;
};

/**
 * A menu of choices whose trigger shows the current one: "All models" first,
 * then the report's own. The menu shows a search above 5 options by itself.
 * The parts of the filter row are bare, so the trigger is ghost.
 */
function ChoiceMenu({ allLabel, choices, value, onChange }: ChoiceMenuProps) {
  const current = choices.find((choice) => choice.value === value);
  return (
    <Dropdown
      triggerComponent={ButtonTrigger}
      tone="ghost"
      label={value === '' ? allLabel : (current?.label ?? value)}
    >
      <Dropdown.Menu>
        <Dropdown.Option active={value === ''} onPick={() => onChange('')}>
          {allLabel}
        </Dropdown.Option>
        <Dropdown.Separator />
        {choices.map((choice) => (
          <Dropdown.Option
            key={choice.value}
            keywords={choice.keywords}
            active={choice.value === value}
            onPick={() => onChange(choice.value)}
          >
            {choice.label}
          </Dropdown.Option>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

function localeChoices(locales: readonly string[], uiLocale: string): Choice[] {
  return locales
    .map((code) => ({
      value: code,
      label: localeName(code, uiLocale),
      keywords: [code],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale));
}

type FilterToolbarProps = {
  filters: Filters;
  onChange: (next: Filters) => void;
  dimensions: ReportDimensions;
  /** The text field takes the focus when the user opens the row. */
  autoFocus: boolean;
  /** Closes the row, which clears the text, model and locale filters. */
  onClose: () => void;
  uiLocale: string;
};

/**
 * The filter row under the title bar: the text of the URL, then the model and
 * the locale, each only when the report has more than one. A URL matches when
 * one of its places matches all three. The three filter one list, so they
 * are one filter form: one search landmark, named after the pane ("URLs").
 * The "✕" of the text and Escape in it close the row, which clears the three.
 */
export function FilterToolbar({
  filters,
  onChange,
  dimensions,
  autoFocus,
  onClose,
  uiLocale,
}: FilterToolbarProps) {
  const pickModel = dimensions.models.length > 1;
  const pickLocale = dimensions.locales.length > 1;
  return (
    <Toolbar fields onClose={onClose}>
      <Toolbar.Search className={styles.filters}>
        <Toolbar.FilterInput
          value={filters.query}
          onChange={(query) => onChange({ ...filters, query })}
          autoFocus={autoFocus}
          onClose={onClose}
        />
        {(pickModel || pickLocale) && <Toolbar.Divider />}
        {pickModel && (
          <ChoiceMenu
            allLabel="All models"
            choices={dimensions.models.map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            value={filters.modelId}
            onChange={(modelId) => onChange({ ...filters, modelId })}
          />
        )}
        {pickLocale && (
          <ChoiceMenu
            allLabel="All locales"
            choices={localeChoices(dimensions.locales, uiLocale)}
            value={filters.locale}
            onChange={(locale) => onChange({ ...filters, locale })}
          />
        )}
      </Toolbar.Search>
    </Toolbar>
  );
}
