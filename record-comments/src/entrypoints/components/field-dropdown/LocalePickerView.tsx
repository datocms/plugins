import type { MutableRefObject, ReactNode, Ref } from 'react';
import styles from '@styles/comment.module.css';

type LocalePickerViewProps = {
  locales: string[];
  selectedIndex: number;
  onSelect: (locale: string) => void;
  onHover: (index: number) => void;
  selectedRef: Ref<HTMLButtonElement>;
  justClickedInsideRef: MutableRefObject<boolean>;
};

export function LocalePickerView({
  locales,
  selectedIndex,
  onSelect,
  onHover,
  selectedRef,
  justClickedInsideRef,
}: LocalePickerViewProps): ReactNode {
  return (
    <div className={styles.mentionList} role="listbox" aria-label="Select locale">
      {locales.map((locale, index) => (
        <button
          key={locale}
          ref={index === selectedIndex ? selectedRef : null}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={`${styles.mentionOption} ${index === selectedIndex ? styles.mentionOptionSelected : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            justClickedInsideRef.current = true;
            onSelect(locale);
          }}
          onClick={() => onSelect(locale)}
          onMouseEnter={() => onHover(index)}
        >
          <span className={styles.mentionLocaleBadge}>{locale.toUpperCase()}</span>
          <span className={styles.mentionFieldLabel}>{locale}</span>
        </button>
      ))}
    </div>
  );
}

export default LocalePickerView;
