import Toolbar from 'datocms-react-ui/Toolbar';
import type { KeyboardEvent } from 'react';
import { ArrowRightIcon } from '../../icons';
import type {
  FindInput,
  FindOption,
  FindRowView,
  ModelFilterView,
  ReplaceInput,
} from '../contract';
import { type Copy, STRINGS } from './copy';
import styles from './FindBar.module.css';
import { type ControlDisabled, FindGroup } from './FindGroup';
import { ModelFilter } from './ModelFilter';
import { ReplaceGroup } from './ReplaceGroup';

/** The ids of the problem texts of the find form, by field. */
export type FieldProblemIds = {
  pattern?: string;
  replacement?: string;
};

export type FindBarHandlers = {
  onPatternChange: (pattern: string) => void;
  onFindKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onOptionChange: (option: FindOption, on: boolean) => void;
  onReplacementChange: (text: string) => void;
  onReplaceKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveChange: (on: boolean) => void;
  onModelFilterChange: (modelId: string | null) => void;
};

type FindBarProps = {
  /** The id of the Find input (the page focuses it by id). */
  findInputId: string;
  find: FindInput;
  replace: ReplaceInput;
  findRow: FindRowView;
  invalid: boolean;
  /**
   * The ids of the problems of the fields that the page shows above the
   * results, if any: each field takes its own as its description.
   */
  problemIds?: FieldProblemIds;
  modelFilter: ModelFilterView | null;
  copy: Copy;
  handlers: FindBarHandlers;
  /** The page is still loading: every control is disabled, with no reason to give. */
  booting?: boolean;
};

/**
 * The find form, a toolbar of fields under the title bar: Find with its
 * options → Replace with, the eraser and the model filter. It takes the
 * Pane's name ("Records") as its search name. One line from 960px of frame
 * width, two lines below.
 */
export function FindBar({
  findInputId,
  find,
  replace,
  findRow,
  invalid,
  problemIds,
  modelFilter,
  copy,
  handlers,
  booting = false,
}: FindBarProps) {
  const disabled: ControlDisabled = booting
    ? true
    : { reason: STRINGS.searchDisabledReason };

  return (
    <Toolbar fields>
      <Toolbar.Search className={styles.form}>
        <FindGroup
          inputId={findInputId}
          find={find}
          enabled={findRow.enabled}
          disabled={disabled}
          showClear={findRow.showClear}
          awaitingEnter={findRow.awaitingEnter}
          invalid={invalid}
          problemId={problemIds?.pattern}
          onPatternChange={handlers.onPatternChange}
          onKeyDown={handlers.onFindKeyDown}
          onClear={handlers.onClear}
          onOptionChange={handlers.onOptionChange}
        />
        <span className={styles.arrow} aria-hidden="true">
          <ArrowRightIcon />
        </span>
        <ReplaceGroup
          replace={replace}
          regex={find.regex}
          enabled={findRow.enabled}
          disabled={disabled}
          showEraser={findRow.showEraser}
          problemId={problemIds?.replacement}
          onTextChange={handlers.onReplacementChange}
          onKeyDown={handlers.onReplaceKeyDown}
          onRemoveChange={handlers.onRemoveChange}
        >
          {modelFilter?.visible && (
            <ModelFilter
              view={modelFilter}
              copy={copy}
              onChange={handlers.onModelFilterChange}
            />
          )}
        </ReplaceGroup>
      </Toolbar.Search>
    </Toolbar>
  );
}
