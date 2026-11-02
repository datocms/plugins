import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import EntityRow from 'datocms-react-ui/EntityRow';
import { useRef } from 'react';
import type { ModelFilterView } from '../contract';
import { type Copy, STRINGS } from './copy';

type ModelFilterProps = {
  view: ModelFilterView;
  copy: Copy;
  onChange: (modelId: string | null) => void;
};

/**
 * "All models": a menu of choices over the results (it never searches
 * again). Records it hides aren't shown, counted or written. Each option
 * says how many matches its model has. The kit handles the keyboard and the
 * search above 5 options. A run disables it and closes an open menu.
 */
export function ModelFilter({ view, copy, onChange }: ModelFilterProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const choose = (modelId: string | null) => {
    onChange(modelId);
    // The menu closes after a pick; the focus goes back to the trigger, not
    // to the end of the page.
    rootRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
  };

  return (
    <div ref={rootRef}>
      <Dropdown
        // Remounted when a run disables it, so an open menu closes with it.
        key={view.enabled ? 'enabled' : 'disabled'}
        triggerComponent={ButtonTrigger}
        tone="ghost"
        label={copy.filterTrigger(view.selected)}
        disabled={
          view.enabled ? undefined : { reason: STRINGS.searchDisabledReason }
        }
      >
        <Dropdown.Menu placement="bottom-end">
          <Dropdown.Option
            active={view.selected === null}
            onPick={() => choose(null)}
          >
            <EntityRow
              layout="row"
              title={STRINGS.allModels}
              aside={copy.optionCount(view.allMatchCount, view.partial)}
            />
          </Dropdown.Option>
          <Dropdown.Separator />
          {view.options.map((option) => (
            <Dropdown.Option
              key={option.id}
              active={view.selected?.id === option.id}
              keywords={[option.name]}
              onPick={() => choose(option.id)}
            >
              <EntityRow
                layout="row"
                title={option.name}
                aside={copy.optionCount(option.matchCount, view.partial)}
              />
            </Dropdown.Option>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}
