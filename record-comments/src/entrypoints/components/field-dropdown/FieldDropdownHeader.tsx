import Button from 'datocms-react-ui/Button';
import type { MutableRefObject, ReactNode, Ref } from 'react';
import { ChevronLeftIcon } from '../Icons';
import styles from '../shared/MentionPanel.module.css';

type FieldDropdownHeaderProps = {
  /** The path of the drill-down, for example "Content · Blocks" */
  title: string;
  onBack: () => void;
  justClickedInsideRef: MutableRefObject<boolean>;
  /** The title is taller than text: the panel scrolls the options below it */
  ref?: Ref<HTMLSpanElement>;
};

/** The group title of a drill-down: Back, then the path */
export function FieldDropdownHeader({
  title,
  onBack,
  justClickedInsideRef,
  ref,
}: FieldDropdownHeaderProps): ReactNode {
  return (
    <span ref={ref} className={styles.header}>
      <Button
        tone="ghost"
        size="micro"
        iconOnly
        icon={ChevronLeftIcon}
        label="Back"
        onMouseDown={(event) => {
          // The editor keeps the focus and the caret
          event.preventDefault();
          justClickedInsideRef.current = true;
        }}
        onClick={onBack}
      />
      <span className={styles.headerText}>{title}</span>
    </span>
  );
}
