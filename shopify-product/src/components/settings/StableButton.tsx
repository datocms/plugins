import type { ButtonProps } from 'datocms-react-ui';
import { type MouseEvent, useLayoutEffect, useRef } from 'react';
import { Button } from '../../ui/Button';
import styles from './StableButton.module.css';

type Props = Omit<ButtonProps, 'disabled'> & {
  /** Can't be used right now: looks and reads as disabled, but keeps focus. */
  unavailable: boolean;
};

/**
 * The ui Button for actions that become unavailable while they have focus
 * (Save while saving, Re-check while checking). A `disabled` button drops
 * keyboard focus to `<body>`; this one stays focusable, carries
 * `aria-disabled`, and swallows clicks (a submit button doesn't submit).
 */
export function StableButton({
  unavailable,
  onClick,
  className,
  ...props
}: Props) {
  const anchor = useRef<HTMLSpanElement>(null);

  // The kit Button forwards no ARIA props.
  useLayoutEffect(() => {
    const button = anchor.current?.querySelector('button');
    if (!button) return;
    if (unavailable) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }, [unavailable]);

  const handleClick = (event: MouseEvent) => {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <span ref={anchor} className={styles.anchor}>
      <Button
        {...props}
        className={[unavailable && styles.unavailable, className]
          .filter(Boolean)
          .join(' ')}
        onClick={handleClick}
      />
    </span>
  );
}
