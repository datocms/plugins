import type { MutableRefObject, ReactNode, Ref } from 'react';
import { MentionMenuItem } from '../shared/MentionPanel';

type LocalePickerViewProps = {
  locales: string[];
  selectedIndex: number;
  onSelect: (locale: string) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLDivElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
  /** The language of the user, for the names of the languages */
  uiLocale?: string;
};

/**
 * The name of the language of a locale in the language of the user, with
 * its code as the pill of the mention writes it: "Italian (IT)"
 */
function describeLocale(locale: string, uiLocale: string | undefined): string {
  const code = locale.toUpperCase();
  try {
    const name = new Intl.DisplayNames(uiLocale ?? 'en', {
      type: 'language',
    }).of(locale);
    return name && name.toLowerCase() !== locale.toLowerCase()
      ? `${name} (${code})`
      : code;
  } catch {
    // A code that is not a language tag
    return code;
  }
}

/** The locales of a localized field, by the name of their language */
export function LocalePickerView({
  locales,
  selectedIndex,
  onSelect,
  onHover,
  selectedRef,
  justClickedInsideRef,
  uiLocale,
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
      {describeLocale(locale, uiLocale)}
    </MentionMenuItem>
  ));
}
