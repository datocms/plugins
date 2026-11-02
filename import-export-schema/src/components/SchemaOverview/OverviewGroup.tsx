import CardList from 'datocms-react-ui/CardList';
import Pill from 'datocms-react-ui/Pill';
import type { ReactNode } from 'react';
import { useFormatters } from '@/texts';
import { type OverviewKind, overviewKindIcons } from './OverviewItem';
import s from './overview.module.css';
import { EntriesPagination, usePaginatedEntries } from './PaginatedEntries';

const groupTitles: Record<OverviewKind, string> = {
  model: 'Models',
  block: 'Blocks',
  plugin: 'Plugins',
};

// The count in the header names what it counts: "12 models"
const countNouns: Record<OverviewKind, [one: string, other: string]> = {
  model: ['model', 'models'],
  block: ['block', 'blocks'],
  plugin: ['plugin', 'plugins'],
};

type Props<T> = {
  kind: OverviewKind;
  entries: readonly T[];
  /**
   * The id of the entity of an entry: the page of the focused entity shows,
   * and a change of page releases the focus
   */
  getEntityId?: (entry: T) => string;
  /**
   * The only group of the overview: the subtitle of the pane already counts
   * its entries
   */
  onlyGroup?: boolean;
  /** Renders an entry: an OverviewItem with a key */
  children: (entry: T) => ReactNode;
};

/**
 * The models, the blocks or the plugins of an overview, in one card. Past
 * 200 entries, the card shows 100 per page, with the pages under it, and
 * its header counts them all, unless it is the only group: a short card
 * needs no count.
 */
export function OverviewGroup<T>({
  kind,
  entries,
  getEntityId,
  onlyGroup = false,
  children,
}: Props<T>) {
  const format = useFormatters();
  const pagination = usePaginatedEntries(entries, getEntityId);
  const title = groupTitles[kind];
  const [one, other] = countNouns[kind];
  const KindIcon = overviewKindIcons[kind];

  return (
    <div className={s.group}>
      <CardList
        header={{
          image: <KindIcon />,
          title,
          trailing:
            pagination.paginated && !onlyGroup ? (
              <Pill>{format.count(entries.length, one, other)}</Pill>
            ) : undefined,
        }}
      >
        {pagination.entries.map((entry) => children(entry))}
      </CardList>
      <EntriesPagination pagination={pagination} ariaLabel={title} />
    </div>
  );
}
