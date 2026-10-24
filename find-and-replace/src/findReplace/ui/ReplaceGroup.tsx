import StringInput from 'datocms-react-ui/StringInput';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { KeyboardEvent, ReactNode } from 'react';
import { EraserIcon } from '../../icons';
import type { ReplaceInput } from '../contract';
import { STRINGS } from './copy';
import styles from './FindBar.module.css';
import type { ControlDisabled } from './FindGroup';

type ReplaceGroupProps = {
  replace: ReplaceInput;
  regex: boolean;
  enabled: boolean;
  /** How the eraser is disabled when `enabled` is false. */
  disabled: ControlDisabled;
  showEraser: boolean;
  /**
   * The id of the text that says why the replacement can't run, while the
   * page shows it: the input is then invalid, with it as its description.
   */
  problemId?: string;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveChange: (on: boolean) => void;
  /** The model filter, at the end of the line. */
  children?: ReactNode;
};

/**
 * "Replace with" and the eraser ("Replace with nothing"). With the eraser on,
 * the input is disabled and reads "Matches will be removed"; the typed text
 * is kept and comes back when it's turned off.
 */
export function ReplaceGroup({
  replace,
  regex,
  enabled,
  disabled,
  showEraser,
  problemId,
  onTextChange,
  onKeyDown,
  onRemoveChange,
  children,
}: ReplaceGroupProps) {
  return (
    <div className={styles.replace}>
      <div className={styles.field}>
        {/* Like Find: a field of the bar, with no FieldWrapper. The
            replacement problem shows above the results, and the input is
            invalid and points to it while it shows. */}
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
          aria-invalid={problemId ? true : undefined}
          aria-describedby={problemId}
          code={regex}
          spellCheck={false}
          autoComplete="off"
          disabled={!enabled || replace.remove}
        />
      </div>
      {showEraser && (
        <Toolbar.Button
          iconOnly
          icon={EraserIcon}
          label={STRINGS.replaceWithNothing}
          pressed={replace.remove}
          disabled={enabled ? undefined : disabled}
          onClick={() => onRemoveChange(!replace.remove)}
        />
      )}
      {children}
    </div>
  );
}
