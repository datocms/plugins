import { Shortcut } from 'datocms-react-ui/Actions';
import type { ButtonProps } from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import InputGroup from 'datocms-react-ui/InputGroup';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { KeyboardEvent } from 'react';
import { SearchIcon, XmarkIcon } from '../../icons';
import type { FindInput, FindOption } from '../contract';
import { optionsLabel, STRINGS } from './copy';
import styles from './FindBar.module.css';

/** A control's `disabled`: plainly, or with the reason it waits. */
export type ControlDisabled = ButtonProps['disabled'];

type FindGroupProps = {
  /** The id of the Find input: the page moves the focus to it by id. */
  inputId: string;
  find: FindInput;
  /** "Replace with nothing" is on. */
  remove: boolean;
  /** "Replace with nothing" is an option: there are results, or it is on. */
  showRemove: boolean;
  enabled: boolean;
  /** How the controls are disabled when `enabled` is false: plainly while booting, with a reason during a pass. */
  disabled: ControlDisabled;
  showClear: boolean;
  /** The text or settings in the field haven't been searched yet (large projects). */
  awaitingEnter: boolean;
  /**
   * The id of the text that says what is wrong with the pattern, while the
   * page shows it: the input takes it as its description.
   */
  problemId?: string;
  onPatternChange: (pattern: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onOptionChange: (option: FindOption, on: boolean) => void;
  onRemoveChange: (on: boolean) => void;
};

/** The Enter keycap after the text, described once to screen readers. */
function EnterHint() {
  return (
    <>
      <span aria-hidden="true">
        <Shortcut keys={{ key: 'enter' }} />
      </span>
      <span className="visually-hidden">{STRINGS.pressEnter}</span>
    </>
  );
}

type FindOptionsProps = Pick<
  FindGroupProps,
  'find' | 'remove' | 'showRemove' | 'onOptionChange' | 'onRemoveChange'
> & { disabled: ControlDisabled };

/**
 * "Options": the settings of the search and of the replacement, each with
 * its name and a checkbox. The menu stays open while they change. The
 * trigger names the options that are on ("Options: Match case").
 */
function FindOptions({
  find,
  remove,
  showRemove,
  disabled,
  onOptionChange,
  onRemoveChange,
}: FindOptionsProps) {
  const option = (name: FindOption, checked: boolean) => ({
    checked,
    onChange: (on: boolean) => onOptionChange(name, on),
  });

  return (
    <Dropdown
      triggerComponent={ButtonTrigger}
      tone="ghost"
      label={optionsLabel(find, remove)}
      disabled={disabled}
    >
      <Dropdown.Menu placement="bottom-end" contextualSearch={false}>
        <Dropdown.Option checkbox={option('caseSensitive', find.caseSensitive)}>
          {STRINGS.matchCase}
        </Dropdown.Option>
        <Dropdown.Option checkbox={option('wholeWord', find.wholeWord)}>
          {STRINGS.matchWholeWord}
        </Dropdown.Option>
        <Dropdown.Option checkbox={option('regex', find.regex)}>
          {STRINGS.useRegex}
        </Dropdown.Option>
        {showRemove && (
          <>
            <Dropdown.Separator />
            <Dropdown.Option
              checkbox={{ checked: remove, onChange: onRemoveChange }}
            >
              {STRINGS.replaceWithNothing}
            </Dropdown.Option>
          </>
        )}
        {find.regex && <Dropdown.Text>{STRINGS.regexTip}</Dropdown.Text>}
      </Dropdown.Menu>
    </Dropdown>
  );
}

/** ⌕ Find [Enter] · ✕ · Options (Match case, Match whole word, Use regular expression, Replace with nothing). */
export function FindGroup({
  inputId,
  find,
  remove,
  showRemove,
  enabled,
  disabled,
  showClear,
  awaitingEnter,
  problemId,
  onPatternChange,
  onKeyDown,
  onClear,
  onOptionChange,
  onRemoveChange,
}: FindGroupProps) {
  const controlDisabled = enabled ? undefined : disabled;

  return (
    <div className={styles.find}>
      <div className={styles.field}>
        {/* A field of the search bar, like the kit's own filter input: no
            FieldWrapper, whose label (hidden or not) and error line would
            push the box off the line of the bar's buttons. The pattern
            problem shows once, in place of the results, and the input takes
            that text as its description; the input group reads its addons
            (the Enter hint) after it. */}
        <InputGroup
          id={inputId}
          pre={
            <span className={styles.findIcon}>
              <SearchIcon />
            </span>
          }
          post={awaitingEnter && enabled ? <EnterHint /> : undefined}
          code={find.regex}
          aria-label={STRINGS.findLabel}
          placeholder={STRINGS.findPlaceholder}
          value={find.pattern}
          onChange={(value) => onPatternChange(value ?? '')}
          onKeyDown={onKeyDown}
          aria-describedby={problemId}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
          disabled={!enabled}
        />
      </div>
      {showClear && (
        <Toolbar.Button
          iconOnly
          icon={XmarkIcon}
          label={STRINGS.clearSearch}
          disabled={controlDisabled}
          onClick={onClear}
        />
      )}
      <FindOptions
        find={find}
        remove={remove}
        showRemove={showRemove}
        disabled={controlDisabled}
        onOptionChange={onOptionChange}
        onRemoveChange={onRemoveChange}
      />
    </div>
  );
}
