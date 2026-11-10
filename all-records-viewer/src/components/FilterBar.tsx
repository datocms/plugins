import Button from 'datocms-react-ui/Button';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useRef } from 'react';
import type { FilterCondition, FilterField } from '../filters/types';
import type { CreatorOption } from '../filters/useCreatorOptions';
import { AddIcon, CloseIcon } from '../icons';
import s from './FilterBar.module.css';
import { FilterTile, newCondition } from './FilterTile';

/**
 * The filter row of the list, as in the record list of the dashboard: the
 * text filter, then one tile for each filter, a “+” that adds one, and a “✕”
 * that clears them.
 */
export function FilterBar({
  search,
  searchDisabled,
  autoFocus,
  onSearchChange,
  onClose,
  filters,
  fields,
  locales,
  creators,
  filtersDisabled,
  onFiltersChange,
}: {
  search: string;
  searchDisabled: boolean;
  autoFocus: boolean;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  filters: readonly FilterCondition[];
  fields: readonly FilterField[];
  locales: readonly string[];
  creators: { options: readonly CreatorOption[]; loading: boolean };
  filtersDisabled: boolean;
  onFiltersChange: (filters: FilterCondition[]) => void;
}) {
  const firstField = fields[0];
  // A key for each tile, which stays when a tile before it goes. The keys of
  // a change wait for its tiles to reach the URL; tiles that come from
  // elsewhere (a link, the history) get new keys.
  const keys = useRef<{
    next: number;
    list: number[];
    pending: number[] | null;
  }>({ next: 0, list: [], pending: null });
  const { pending } = keys.current;
  if (pending && pending.length === filters.length) {
    keys.current.list = pending;
    keys.current.pending = null;
  } else if (keys.current.list.length !== filters.length) {
    keys.current.list = filters.map(() => keys.current.next++);
  }
  const change = (next: FilterCondition[], list: number[]) => {
    keys.current.pending = list;
    onFiltersChange(next);
  };

  return (
    <Toolbar.Search>
      <div className={s.row}>
        <div className={`${s.cell} ${s.search}`}>
          <Toolbar.FilterInput
            value={search}
            onChange={onSearchChange}
            autoFocus={autoFocus}
            onClose={onClose}
            disabled={searchDisabled}
          />
        </div>
        <Toolbar.Divider />
        <div className={s.tiles}>
          {filters.map((condition, index) => (
            <FilterTile
              key={keys.current.list[index]}
              condition={condition}
              fields={fields}
              locales={locales}
              creators={creators}
              onChange={(next) =>
                onFiltersChange(
                  filters.map((entry, at) => (at === index ? next : entry)),
                )
              }
              onRemove={() =>
                change(
                  filters.filter((_, at) => at !== index),
                  keys.current.list.filter((_, at) => at !== index),
                )
              }
            />
          ))}
          {firstField && (
            <div className={s.cell}>
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={AddIcon}
                label="Add new filter"
                disabled={
                  filtersDisabled
                    ? { reason: 'Wait for the current action to finish.' }
                    : undefined
                }
                onClick={() =>
                  change(
                    [...filters, newCondition(firstField)],
                    [...keys.current.list, keys.current.next++],
                  )
                }
              />
            </div>
          )}
        </div>
        {filters.length > 0 && (
          <div className={s.cell}>
            <Button
              tone="ghost"
              size="micro"
              iconOnly
              icon={CloseIcon}
              label="Clear the filters"
              onClick={() => change([], [])}
            />
          </div>
        )}
      </div>
    </Toolbar.Search>
  );
}
