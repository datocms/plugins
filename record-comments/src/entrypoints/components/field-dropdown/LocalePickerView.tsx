import type { MutableRefObject, ReactNode, Ref } from 'react';
import { MentionMenuItem } from '../shared/MentionPanel';

type LocalePickerViewProps = {
  locales: string[];
  selectedIndex: number;
  onSelect: (locale: string) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLDivElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
};

/** The locales of a localized field, by their code */
export function LocalePickerView({
  locales,
  selectedIndex,
  onSelect,
  onHover,
  selectedRef,
  justClickedInsideRef,
}: LocalePickerViewProps): ReactNode {
  return locales.map((locale, index) => (
    <MentionMenuItem
      key={locale}
      selected={index === selectedIndex}
      highlightRef={selectedRef}
      onPress={() => {
        justClickedInsideRef.current = true;
      }}
      onPick={() => onSelect(locale)}
      onHighlight={() => onHover(index)}
    >
      {locale}
    </MentionMenuItem>
  ));
}
