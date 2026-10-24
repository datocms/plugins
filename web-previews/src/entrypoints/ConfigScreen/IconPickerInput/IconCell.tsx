import { useCtx } from 'datocms-react-ui/Canvas';
import SelectInput from 'datocms-react-ui/SelectInput';
import type { TableListCell } from 'datocms-react-ui/TableList';
import { useMemo, useState } from 'react';
import {
  ICON_RESULTS_LIMIT,
  iconByName,
  searchIconNames,
} from '../../../icons';
import { iconCountText } from '../../../texts';
import type { RawViewport } from '../../../types';
import s from './styles.module.css';

type IconOption = { value: string; label: string };

function toOption(name: string): IconOption {
  return { value: name, label: name };
}

/** The glyph of an icon before its name, in the cell and in the menu */
function IconLabel({ name }: { name: string }) {
  const Glyph = iconByName(name);

  return (
    <span className={s.option}>
      {Glyph && <Glyph />}
      <span className={s.name}>{name}</span>
    </span>
  );
}

const formatOptionLabel = (option: IconOption) => (
  <IconLabel name={option.value} />
);

const noOptionsMessage = ({ inputValue }: { inputValue: string }) =>
  `No icons match “${inputValue}”`;

type Props = {
  cell: TableListCell<RawViewport>;
};

/**
 * The icon of a viewport, in its cell of the list: a select of the names of
 * the solid icons, each with its glyph. A pick applies at once.
 */
export function IconCell({ cell }: Props) {
  const { index, value, onChange, onBlur } = cell;
  // The class of the cell input is for a text input: the select does not
  // take it
  const { className: _className, ...inputProps } = cell.inputProps;
  const name = typeof value === 'string' ? value : '';
  const [query, setQuery] = useState('');
  const { locale } = useCtx().ui;

  // The solid set has about 2,000 names: the menu shows only the first
  // matches, and typing narrows them. The title of the one group tells how
  // many match, thus the first names don't look like the whole set.
  const options = useMemo(() => {
    const matches = searchIconNames(query);

    if (matches.length === 0) {
      return [];
    }

    return [
      {
        label: iconCountText({
          count: matches.length,
          limit: ICON_RESULTS_LIMIT,
          locale,
        }),
        options: matches.slice(0, ICON_RESULTS_LIMIT).map(toOption),
      },
    ];
  }, [query, locale]);

  return (
    <SelectInput
      {...inputProps}
      name={`icon-${index}`}
      value={name || null}
      onChange={(newValue) => onChange(newValue ?? '')}
      onBlur={onBlur}
      // Closing the menu leaves the cell, as a blur does: an icon that is
      // still missing shows its error
      onMenuClose={onBlur}
      options={options}
      search={{ onQueryChange: setQuery }}
      // The current icon may be past the first matches, and a saved name may
      // not be in the set: the cell still shows it
      acceptValueNotIncludedInOptions={toOption}
      formatOptionLabel={formatOptionLabel}
      noOptionsMessage={noOptionsMessage}
      placeholder="Choose an icon"
      // The menu stays in the stacking layer of its cell, under the add
      // button of the list, which would take the clicks on the options that
      // it covers: the menu opens above the cell, away from that button
      menuPlacement="top"
      clearable={false}
      variant="embedded"
      classNamePrefix="TableList__select"
    />
  );
}
