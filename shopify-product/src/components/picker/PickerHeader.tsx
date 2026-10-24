import SegmentedControl from 'datocms-react-ui/SegmentedControl';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { ReactNode } from 'react';
import { GridIcon, ListIcon } from '../../icons';
import styles from './PickerBars.module.css';
import type { PickerView } from './usePickerView';

/** The box of the search, where focus goes when its holder leaves. */
const SEARCH_ID = 'shopify-picker-search';

/**
 * Moves focus to the search, the picker's starting point. Controls that
 * leave or turn disabled once used (the search's ✕, Clear, Clear filters)
 * hand focus here.
 */
export function focusSearch(): void {
  document.getElementById(SEARCH_ID)?.querySelector('input')?.focus();
}

const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid', icon: <GridIcon /> },
  { value: 'list', label: 'List', icon: <ListIcon /> },
] as const;

type Props = {
  text: string;
  onTextChange: (text: string) => void;
  view: PickerView;
  onViewChange: (view: PickerView) => void;
  /** New results load while the last ones still show. */
  reloading: boolean;
  /** The market menu (MarketSwitcher). */
  market: ReactNode;
  /** The filter bar, for products and variants only. */
  filterBar: ReactNode;
};

/**
 * The fixed top of the picker: a toolbar of fields with the text filter of
 * the results (named by the Pane, focused when the picker opens, with its ✕
 * while it has text), the spinner while new results load over the last ones,
 * the layout and the market, then (products and variants) the filter bar.
 * The Pane draws the line under each toolbar.
 */
export default function PickerHeader({
  text,
  onTextChange,
  view,
  onViewChange,
  reloading,
  market,
  filterBar,
}: Props) {
  return (
    <>
      <Toolbar fields>
        <div id={SEARCH_ID} className={styles.search}>
          <Toolbar.FilterInput
            value={text}
            onChange={(next) => {
              onTextChange(next);
              // Its ✕ leaves once the text is gone: focus stays in the search.
              if (next === '') focusSearch();
            }}
          />
        </div>
        <Toolbar.Spinner show={reloading} />
        <SegmentedControl
          ariaLabel="Layout"
          options={VIEW_OPTIONS}
          value={view}
          onChange={onViewChange}
        />
        {market}
      </Toolbar>
      {filterBar}
    </>
  );
}
