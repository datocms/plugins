import StringInput from 'datocms-react-ui/StringInput';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ReplaceInput } from '../contract';
import { STRINGS } from './copy';
import styles from './FindBar.module.css';

type ReplaceGroupProps = {
  replace: ReplaceInput;
  regex: boolean;
  enabled: boolean;
  /**
   * The id of the text that says why the replacement can't run, while the
   * page shows it: the input takes it as its description.
   */
  problemId?: string;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** The model filter, at the end of the line. */
  children?: ReactNode;
};

/**
 * "Replace with". With "Replace with nothing" on (in Options), the input is
 * disabled and reads "Matches will be removed"; the typed text is kept and
 * comes back when it's turned off.
 */
export function ReplaceGroup({
  replace,
  regex,
  enabled,
  problemId,
  onTextChange,
  onKeyDown,
  children,
}: ReplaceGroupProps) {
  return (
    <div className={styles.replace}>
      <div className={styles.field}>
        {/* Like Find: a field of the bar, with no FieldWrapper. The
            replacement problem shows above the results, and the input
            points to it while it shows. */}
        <StringInput
          aria-label={STRINGS.replaceLabel}
          placeholder={
            replace.remove
              ? STRINGS.replacePlaceholderRemove
              : STRINGS.replacePlaceholder
          }
          value={replace.remove ? '' : replace.text}
          onChange={(value) => onTextChange(value ?? '')}
          onKeyDown={onKeyDown}
          aria-describedby={problemId}
          code={regex}
          spellCheck={false}
          autoComplete="off"
          disabled={!enabled || replace.remove}
        />
      </div>
      {children}
    </div>
  );
}
