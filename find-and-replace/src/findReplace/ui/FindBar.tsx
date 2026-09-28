import { Toolbar, ToolbarStack } from 'datocms-react-ui';
import type { KeyboardEvent, RefObject } from 'react';
import { faArrowRight, Icon } from '../../ui/icons';
import type {
  FindInput,
  FindOption,
  FindRowView,
  ModelFilterView,
  ReplaceInput,
} from '../contract';
import type { Copy } from './copy';
import { FindGroup } from './FindGroup';
import { ModelFilter } from './ModelFilter';
import { ReplaceGroup } from './ReplaceGroup';

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
  find: FindInput;
  replace: ReplaceInput;
  findRow: FindRowView;
  invalid: boolean;
  modelFilter: ModelFilterView | null;
  copy: Copy;
  findInputRef: RefObject<HTMLInputElement | null>;
  handlers: FindBarHandlers;
};

/** The find row: Find group → arrow → Replace group + optional model filter. Wraps below 768px, and the row grows with it. */
export function FindBar({
  find,
  replace,
  findRow,
  invalid,
  modelFilter,
  copy,
  findInputRef,
  handlers,
}: FindBarProps) {
  return (
    <Toolbar className="fr-toolbar fr-toolbar--find">
      <ToolbarStack
        stackSize="s"
        style={{ gap: 'var(--spacing-m)', minWidth: 0 }}
      >
        <div className="fr-bar">
          <FindGroup
            find={find}
            enabled={findRow.enabled}
            showClear={findRow.showClear}
            enterToSearch={findRow.enterToSearch}
            awaitingEnter={findRow.awaitingEnter}
            invalid={invalid}
            inputRef={findInputRef}
            onPatternChange={handlers.onPatternChange}
            onKeyDown={handlers.onFindKeyDown}
            onClear={handlers.onClear}
            onOptionChange={handlers.onOptionChange}
          />
          <span className="fr-bar__arrow" aria-hidden="true">
            <Icon glyph={faArrowRight} />
          </span>
          <div className="fr-bar__rest">
            <ReplaceGroup
              replace={replace}
              regex={find.regex}
              enabled={findRow.enabled}
              showEraser={findRow.showEraser}
              onTextChange={handlers.onReplacementChange}
              onKeyDown={handlers.onReplaceKeyDown}
              onRemoveChange={handlers.onRemoveChange}
            />
            {modelFilter?.visible && (
              <div className="fr-bar__filter">
                <ModelFilter
                  view={modelFilter}
                  copy={copy}
                  onChange={handlers.onModelFilterChange}
                />
              </div>
            )}
          </div>
        </div>
      </ToolbarStack>
    </Toolbar>
  );
}
