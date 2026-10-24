import type { FieldInfo } from '@hooks/useMentions';
import ApiKey from 'datocms-react-ui/ApiKey';
import EntityRow from 'datocms-react-ui/EntityRow';
import type { CSSProperties, MutableRefObject, ReactNode, Ref } from 'react';
import { formatCount } from '@/utils/format';
import { ChevronRightIcon } from '../Icons';
import { MentionItemMeta, MentionMenuItem } from '../shared/MentionPanel';
import styles from './FieldListView.module.css';

type FieldMenuItemProps = {
  field: FieldInfo;
  /** The text of the option: the label, or the path of a nested field */
  label: string;
  selected: boolean;
  onPick: () => void;
  onHighlight?: () => void;
  selectedRef: Ref<HTMLDivElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
  /** The depth of a field inside blocks: its content is indented by it */
  depth?: number;
  /** The language of the user, for the separators of the numbers */
  uiLocale?: string;
};

/**
 * A field to mention: its label and API key, the number of its locales, and a
 * chevron when picking it opens a further step (a locale, a block).
 */
export function FieldMenuItem({
  field,
  label,
  selected,
  onPick,
  onHighlight,
  selectedRef,
  justClickedInsideRef,
  depth = 0,
  uiLocale,
}: FieldMenuItemProps): ReactNode {
  const localeCount = field.availableLocales?.length ?? 0;
  const hasMultipleLocales = localeCount > 1;
  // The same rule as the navigation: a block container or a field with
  // more locales asks for the next step
  const drillsDown =
    Boolean(field.isBlockContainer) || (field.localized && hasMultipleLocales);

  return (
    <MentionMenuItem
      selected={selected}
      highlightRef={selectedRef}
      // The option keeps its own padding: a spacer before the content
      // indents it, in even steps
      before={
        depth > 0 ? (
          <span
            aria-hidden="true"
            className={styles.indent}
            style={{ '--depth': depth } as CSSProperties}
          />
        ) : undefined
      }
      onPress={() => {
        justClickedInsideRef.current = true;
      }}
      onPick={onPick}
      onHighlight={onHighlight}
      after={
        hasMultipleLocales || drillsDown ? (
          <MentionItemMeta>
            {hasMultipleLocales &&
              formatCount(localeCount, 'locale', 'locales', uiLocale)}
            {drillsDown && <ChevronRightIcon />}
          </MentionItemMeta>
        ) : undefined
      }
    >
      <EntityRow
        layout="row"
        title={label}
        afterTitle={<ApiKey>{field.apiKey}</ApiKey>}
      />
    </MentionMenuItem>
  );
}

type FieldListViewProps = {
  fields: FieldInfo[];
  selectedIndex: number;
  onSelect: (field: FieldInfo) => void;
  /** Moves the highlight to the field below the pointer */
  onHover?: (index: number) => void;
  selectedRef: Ref<HTMLDivElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
  /** The language of the user, for the separators of the numbers */
  uiLocale?: string;
};

export function FieldListView({
  fields,
  selectedIndex,
  onSelect,
  onHover,
  selectedRef,
  justClickedInsideRef,
  uiLocale,
}: FieldListViewProps): ReactNode {
  return fields.map((field, index) => (
    <FieldMenuItem
      key={field.fieldPath}
      field={field}
      label={field.depth > 0 ? field.displayLabel : field.label}
      selected={index === selectedIndex}
      selectedRef={selectedRef}
      justClickedInsideRef={justClickedInsideRef}
      uiLocale={uiLocale}
      // The fields inside blocks are indented by their depth
      depth={field.depth}
      onPick={() => onSelect(field)}
      onHighlight={onHover ? () => onHover(index) : undefined}
    />
  ));
}
