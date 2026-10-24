import type { FieldInfo } from '@hooks/useMentions';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import type { MutableRefObject, ReactNode, Ref } from 'react';
import { MentionPanelLoading } from '../shared/MentionPanel';
import { FieldMenuItem } from './FieldListView';

type NestedFieldsViewProps = {
  fields: FieldInfo[];
  selectedIndex: number;
  isLoading: boolean;
  onSelect: (field: FieldInfo) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLDivElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
  /** The language of the user, for the separators of the numbers */
  uiLocale?: string;
};

/** The fields inside a block */
export function NestedFieldsView({
  fields,
  selectedIndex,
  isLoading,
  onSelect,
  onHover,
  selectedRef,
  justClickedInsideRef,
  uiLocale,
}: NestedFieldsViewProps): ReactNode {
  if (isLoading) {
    return <MentionPanelLoading>Loading fields…</MentionPanelLoading>;
  }

  if (fields.length === 0) {
    return <Dropdown.MenuEmpty>No fields in this block</Dropdown.MenuEmpty>;
  }

  return fields.map((field, index) => (
    <FieldMenuItem
      key={field.fieldPath}
      field={field}
      label={field.label}
      selected={index === selectedIndex}
      selectedRef={selectedRef}
      justClickedInsideRef={justClickedInsideRef}
      uiLocale={uiLocale}
      onPick={() => onSelect(field)}
      onHighlight={() => onHover(index)}
    />
  ));
}
