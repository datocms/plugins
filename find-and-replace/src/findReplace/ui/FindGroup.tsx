import { Shortcut } from 'datocms-react-ui/Actions';
import type { ButtonProps } from 'datocms-react-ui/Button';
import InputGroup from 'datocms-react-ui/InputGroup';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { KeyboardEvent } from 'react';
import {
  AsteriskIcon,
  FontCaseIcon,
  InputTextIcon,
  SearchIcon,
  XmarkIcon,
} from '../../icons';
import type { FindInput, FindOption } from '../contract';
import { STRINGS } from './copy';
import styles from './FindBar.module.css';

/** A control's `disabled`: plainly, or with the reason it waits. */
export type ControlDisabled = ButtonProps['disabled'];

type FindGroupProps = {
  /** The id of the Find input: the page moves the focus to it by id. */
  inputId: string;
  find: FindInput;
  enabled: boolean;
  /** How the controls are disabled when `enabled` is false: plainly while booting, with a reason during a pass. */
  disabled: ControlDisabled;
  showClear: boolean;
  /** The text or settings in the field haven't been searched yet (large projects). */
  awaitingEnter: boolean;
  invalid: boolean;
  /**
   * The id of the text that says what is wrong with the pattern, while the
   * page shows it: the input takes it as its description.
   */
  problemId?: string;
  onPatternChange: (pattern: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onOptionChange: (option: FindOption, on: boolean) => void;
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

/** ⌕ Find [Enter] · ✕ · Match case · Match whole word · Use regular expression. */
export function FindGroup({
  inputId,
  find,
  enabled,
  disabled,
  showClear,
  awaitingEnter,
  invalid,
  problemId,
  onPatternChange,
  onKeyDown,
  onClear,
  onOptionChange,
}: FindGroupProps) {
  const controlDisabled = enabled ? undefined : disabled;

  return (
    <div className={styles.find}>
      <div className={styles.field}>
        {/* A field of the search bar, like the kit's own filter input: no
            FieldWrapper, whose label (hidden or not) and error line would
            push the box off the line of the bar's buttons. The pattern
            problem shows once, in place of the results: the input is
            invalid and takes that text as its description, and the input
            group reads its addons (the Enter hint) after it. */}
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
          aria-invalid={invalid || undefined}
          aria-describedby={problemId}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
          disabled={!enabled}
        />
      </div>
      <Toolbar.Group>
        {showClear && (
          <Toolbar.Button
            iconOnly
            icon={XmarkIcon}
            label={STRINGS.clearSearch}
            disabled={controlDisabled}
            onClick={onClear}
          />
        )}
        <Toolbar.Button
          iconOnly
          icon={FontCaseIcon}
          label={STRINGS.matchCase}
          pressed={find.caseSensitive}
          disabled={controlDisabled}
          onClick={() => onOptionChange('caseSensitive', !find.caseSensitive)}
        />
        <Toolbar.Button
          iconOnly
          icon={InputTextIcon}
          label={STRINGS.matchWholeWord}
          pressed={find.wholeWord}
          disabled={controlDisabled}
          onClick={() => onOptionChange('wholeWord', !find.wholeWord)}
        />
        <Toolbar.Button
          iconOnly
          icon={AsteriskIcon}
          label={STRINGS.useRegex}
          tooltip={STRINGS.regexTip}
          pressed={find.regex}
          disabled={controlDisabled}
          onClick={() => onOptionChange('regex', !find.regex)}
        />
      </Toolbar.Group>
    </div>
  );
}
