import { TextInput } from 'datocms-react-ui';
import { type KeyboardEvent, type RefObject, useId } from 'react';
import { IconToggle } from '../../ui/IconToggle';
import {
  faAsterisk,
  faFontCase,
  faInputText,
  faMagnifyingGlass,
  faXmark,
  Icon,
} from '../../ui/icons';
import { Tip } from '../../ui/Tip';
import type { FindInput, FindOption } from '../contract';
import { STRINGS } from './copy';

type FindGroupProps = {
  find: FindInput;
  enabled: boolean;
  showClear: boolean;
  /** Large projects: searches start on Enter (the placeholder says so). */
  enterToSearch: boolean;
  /** The text or settings in the field haven't been searched yet. */
  awaitingEnter: boolean;
  invalid: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPatternChange: (pattern: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onOptionChange: (option: FindOption, on: boolean) => void;
};

function placeholderOf(find: FindInput, enterToSearch: boolean): string {
  if (enterToSearch) {
    return find.regex
      ? STRINGS.findPlaceholderRegexEnter
      : STRINGS.findPlaceholderEnter;
  }
  return find.regex ? STRINGS.findPlaceholderRegex : STRINGS.findPlaceholder;
}

/** ⌕ · Find input · [Enter] · ✕ · Match case · Match whole word · Use regular expression. */
export function FindGroup({
  find,
  enabled,
  showClear,
  enterToSearch,
  awaitingEnter,
  invalid,
  inputRef,
  onPatternChange,
  onKeyDown,
  onClear,
  onOptionChange,
}: FindGroupProps) {
  const enterHintId = useId();
  const showEnter = awaitingEnter && enabled;
  const classes = [
    'dl-input-group',
    'fr-find',
    'fr-bar__find',
    invalid ? 'dl-input-group--invalid' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span className="fr-find__icon" aria-hidden="true">
        <Icon glyph={faMagnifyingGlass} />
      </span>
      <TextInput
        id="fr-find"
        type="text"
        value={find.pattern}
        onChange={(value: string) => onPatternChange(value)}
        labelText={STRINGS.findLabel}
        placeholder={placeholderOf(find, enterToSearch)}
        disabled={!enabled}
        inputRef={inputRef as RefObject<HTMLInputElement>}
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="search"
        aria-invalid={invalid || undefined}
        aria-describedby={showEnter ? enterHintId : undefined}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => onKeyDown(event)}
      />
      {showEnter && (
        // Hidden from the reading order: the field's description says it once.
        <span className="fr-find__enter" aria-hidden="true">
          <kbd>{STRINGS.enterKey}</kbd>
          <span id={enterHintId} className="fr-sr-only">
            {STRINGS.pressEnter}
          </span>
        </span>
      )}
      {showClear && (
        <Tip label={STRINGS.clearSearch}>
          <button
            type="button"
            className="fr-find__clear"
            aria-label={STRINGS.clearSearch}
            disabled={!enabled}
            onClick={onClear}
          >
            <Icon glyph={faXmark} />
          </button>
        </Tip>
      )}
      <IconToggle
        glyph={faFontCase}
        label={STRINGS.matchCase}
        pressed={find.caseSensitive}
        disabled={!enabled}
        onChange={(on) => onOptionChange('caseSensitive', on)}
      />
      <IconToggle
        glyph={faInputText}
        label={STRINGS.matchWholeWord}
        pressed={find.wholeWord}
        disabled={!enabled}
        onChange={(on) => onOptionChange('wholeWord', on)}
      />
      <IconToggle
        glyph={faAsterisk}
        label={STRINGS.useRegex}
        pressed={find.regex}
        disabled={!enabled}
        onChange={(on) => onOptionChange('regex', on)}
      />
    </div>
  );
}
