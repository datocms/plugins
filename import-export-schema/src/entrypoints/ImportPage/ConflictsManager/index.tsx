/**
 * The overview pane of the import review: the models, block models and
 * plugins of the file, grouped by kind, with the unresolved conflicts first.
 * Opening an item focuses its node, and its body holds the decisions about
 * it: how to import it, and the new IDs it needs.
 */
import Callout from 'datocms-react-ui/Callout';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import ListArea from 'datocms-react-ui/ListArea';
import Pane, { type ListPreset, useFilteredList } from 'datocms-react-ui/Pane';
import { useState } from 'react';
import { useForm } from 'react-final-form';
import { OverviewGroup } from '@/components/SchemaOverview/OverviewGroup';
import type {
  OverviewEntity,
  OverviewKind,
} from '@/components/SchemaOverview/OverviewItem';
import { type Formatters, useFormatters } from '@/texts';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import type { FormValues } from '../ResolutionsForm';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';
import type {
  ImportReview,
  ItemTypeEntry,
  PluginEntry,
  SectionKey,
} from './useImportReview';

// Collator keeps alphabetical/numeric ordering stable regardless of locale accents.
const localeAwareCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

export function sortConflictEntries<T>(
  items: T[],
  isUnresolved: (entry: T) => boolean,
  hasConflict: (entry: T) => boolean,
  getName: (entry: T) => string,
) {
  // Evaluate potentially expensive field-level resolution checks once per entry.
  return items
    .map((entry) => ({
      entry,
      unresolved: isUnresolved(entry),
      conflict: hasConflict(entry),
      name: getTextWithoutRepresentativeEmojiAndPadding(getName(entry)),
    }))
    .sort(
      (a, b) =>
        Number(b.unresolved) - Number(a.unresolved) ||
        Number(b.conflict) - Number(a.conflict) ||
        localeAwareCollator.compare(a.name, b.name),
    )
    .map(({ entry }) => entry);
}

type EntryBase = {
  /** Unique across kinds: an item type and a plugin can share an ID */
  key: string;
  name: string;
  /** The API key of an item type, the package of a plugin */
  searchKey: string | null;
  /** The conflict still needs a decision of the user */
  unresolved: boolean;
};

type OverviewEntry = EntryBase &
  (
    | { kind: 'model' | 'block'; item: ItemTypeEntry }
    | { kind: 'plugin'; item: PluginEntry }
  );

/** An entry as the lists show it: see `useListOrder` */
type ListedEntry = OverviewEntry & { listedAsUnresolved: boolean };

const sectionKinds: Record<SectionKey, OverviewKind> = {
  models: 'model',
  blocks: 'block',
  plugins: 'plugin',
};

const presetOptions: ListPreset<ListedEntry>[] = [
  {
    id: 'unresolved',
    label: 'With unresolved conflicts',
    shortLabel: 'Unresolved',
    matches: (entry) => entry.listedAsUnresolved,
  },
];

function getEntryEntityId(entry: ListedEntry) {
  return entry.kind === 'plugin'
    ? entry.item.exportPlugin.id
    : entry.item.exportItemType.id;
}

function getEntrySearchTexts(entry: ListedEntry) {
  return [entry.name, entry.searchKey];
}

/** The entries of the review in the order of the overview, sections first */
function buildEntries(review: ImportReview): OverviewEntry[] {
  return review.sectionOrder.flatMap((section): OverviewEntry[] => {
    if (section === 'plugins') {
      return review.pluginEntries.map((item) => ({
        key: `plugin-${item.exportPlugin.id}`,
        kind: 'plugin',
        name: item.exportPlugin.attributes.name,
        searchKey: item.exportPlugin.attributes.package_name ?? null,
        unresolved: review.isPluginConflictUnresolved(item),
        item,
      }));
    }

    return review.itemTypesByCategory[section].map((item) => ({
      key: `itemType-${item.exportItemType.id}`,
      kind: sectionKinds[section] === 'block' ? 'block' : 'model',
      name: item.exportItemType.attributes.name,
      searchKey: item.exportItemType.attributes.api_key,
      unresolved: review.isItemTypeConflictUnresolved(item),
      item,
    }));
  });
}

type ListOrder = {
  entity: OverviewEntity;
  positions: Map<string, number>;
  unresolvedKeys: Set<string>;
  sectionOrder: SectionKey[];
};

/**
 * The order of the lists. While an item is open, they keep the order (and the
 * unresolved preset its members) that they had when it opened: a decision in
 * its body then never moves it away from under the pointer, or takes the
 * focus from the field being typed in. The order follows the decisions again
 * when the item closes, or when another item opens.
 */
function useListOrder(
  focused: OverviewEntity | undefined,
  entries: OverviewEntry[],
  sectionOrder: SectionKey[],
) {
  const [frozen, setFrozen] = useState<ListOrder | null>(null);

  if (focused && frozen?.entity !== focused) {
    setFrozen({
      entity: focused,
      positions: new Map(entries.map((entry, index) => [entry.key, index])),
      unresolvedKeys: new Set(
        entries.filter((entry) => entry.unresolved).map((entry) => entry.key),
      ),
      sectionOrder,
    });
  } else if (!focused && frozen) {
    setFrozen(null);
  }

  return focused && frozen?.entity === focused ? frozen : null;
}

function listEntries(
  entries: OverviewEntry[],
  order: ListOrder | null,
): ListedEntry[] {
  if (!order) {
    return entries.map((entry) => ({
      ...entry,
      listedAsUnresolved: entry.unresolved,
    }));
  }

  const position = (entry: OverviewEntry) =>
    order.positions.get(entry.key) ?? Number.MAX_SAFE_INTEGER;

  return entries
    .map((entry) => ({
      ...entry,
      listedAsUnresolved: order.unresolvedKeys.has(entry.key),
    }))
    .sort((a, b) => position(a) - position(b));
}

/** The option of the "⋮" that gives a new ID to every pending ID at once */
function pendingIdsLabel(format: Formatters, count: number) {
  return count === 1
    ? 'Use a new ID for the pending ID'
    : `Use new IDs for all ${format.number(count)} pending IDs`;
}

/**
 * The entries of the overview in the order of its lists, with its text
 * filter and its preset. The review screen keeps them, because the split
 * unmounts a closed overview: the filter and the preset then survive a close.
 */
export function useConflictsOverviewList(
  review: ImportReview,
  focusedEntity: OverviewEntity | undefined,
) {
  // The review changes with every edit of the form: so do the entries
  const liveEntries = buildEntries(review);
  const order = useListOrder(focusedEntity, liveEntries, review.sectionOrder);
  const entries = listEntries(liveEntries, order);
  const sectionOrder = order?.sectionOrder ?? review.sectionOrder;

  return {
    ...useFilteredList(entries, getEntrySearchTexts, presetOptions),
    sectionOrder,
  };
}

export type ConflictsOverviewList = ReturnType<typeof useConflictsOverviewList>;

type Props = {
  review: ImportReview;
  /** The entries, the filter and the preset: see `useConflictsOverviewList` */
  list: ConflictsOverviewList;
};

/**
 * Organizes the elements of the file by kind, wiring each conflict into the
 * resolutions form.
 */
export default function ConflictsManager({ review, list }: Props) {
  const form = useForm<FormValues>();
  const format = useFormatters();
  const { filter, presets, filteredItems, hasNoResults, sectionOrder } = list;

  const groups = sectionOrder
    .map((section) => {
      const kind = sectionKinds[section];
      return {
        kind,
        entries: filteredItems.filter((entry) => entry.kind === kind),
      };
    })
    .filter((group) => group.entries.length > 0);

  const { pendingIdReplacementKeys } = review;

  return (
    <Pane
      ariaLabel="Schema overview"
      header={
        <Pane.Header filter={filter}>
          <Pane.Header.Title presets={presets}>
            Schema overview
          </Pane.Header.Title>
          <Pane.Header.Subtitle>
            {format.count(filteredItems.length, 'element', 'elements')}
          </Pane.Header.Subtitle>
          {pendingIdReplacementKeys.length > 0 ? (
            <Pane.Header.Menu>
              <Dropdown.Option
                onPick={() =>
                  form.mutators.generateReplacementIds(pendingIdReplacementKeys)
                }
              >
                {pendingIdsLabel(format, pendingIdReplacementKeys.length)}
              </Dropdown.Option>
            </Pane.Header.Menu>
          ) : null}
        </Pane.Header>
      }
    >
      {hasNoResults ? (
        <Pane.FilterBlankSlate />
      ) : (
        <ListArea>
          {review.hasConflicts ? null : (
            <Callout tone="success">
              No model, block or plugin of the file conflicts with the project.
            </Callout>
          )}
          {groups.map((group) => (
            <OverviewGroup
              key={group.kind}
              kind={group.kind}
              entries={group.entries}
              getEntityId={getEntryEntityId}
            >
              {(entry) =>
                entry.kind === 'plugin' ? (
                  <PluginConflict
                    key={entry.key}
                    entry={entry.item}
                    unresolved={entry.unresolved}
                  />
                ) : (
                  <ItemTypeConflict
                    key={entry.key}
                    entry={entry.item}
                    unresolved={entry.unresolved}
                  />
                )
              }
            </OverviewGroup>
          ))}
        </ListArea>
      )}
    </Pane>
  );
}
