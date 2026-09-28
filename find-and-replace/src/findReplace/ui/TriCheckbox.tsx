import { useLayoutEffect, useRef } from 'react';

type TriCheckboxProps = {
  state: 'all' | 'some' | 'none';
  label?: string;
  disabled?: boolean;
  /** Called with the value the click asks for: unchecked or mixed → true, checked → false. */
  onChange: (included: boolean) => void;
};

/** A native checkbox whose mixed state is set on the DOM node (exposed as "mixed"). */
export function TriCheckbox({
  state,
  label,
  disabled = false,
  onChange,
}: TriCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  // Every render: a click clears `indeterminate` even when the state doesn't change.
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === 'some';
    }
  });

  return (
    <input
      ref={ref}
      type="checkbox"
      className="dl-checkbox"
      checked={state === 'all'}
      disabled={disabled}
      aria-label={label}
      onChange={() => onChange(state !== 'all')}
    />
  );
}
