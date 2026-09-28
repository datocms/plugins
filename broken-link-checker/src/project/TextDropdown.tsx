import {
  CaretDownIcon,
  CaretUpIcon,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  DropdownSeparator,
} from 'datocms-react-ui';
import type { KeyboardEvent } from 'react';

export type TextDropdownOption = {
  value: string;
  label: string;
  count?: number;
  separatorAfter?: boolean;
};

type TextDropdownProps = {
  name: 'Status' | 'Model' | 'Locale';
  value: string;
  options: TextDropdownOption[];
  onChange: (value: string) => void;
  uiLocale: string;
};

/**
 * datocms-react-ui 2.5.0 gives every option that mounts in the same millisecond
 * the same id, so Enter in the menu's search field runs the last option's handler
 * whichever is highlighted. Enter in that field clicks the highlighted option's
 * own button instead; an option button that has focus keeps its own Enter. The
 * menu is portaled, so it's found from the key's target; class names are
 * matched on their stable prefix.
 */
function pickHighlighted(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement))
    return;
  const option = event.target
    .closest('[class*="_Dropdown__menu-container_"]')
    ?.querySelector<HTMLButtonElement>(
      '[class*="_Dropdown__menu__option--is-selected_"] > [class*="_Dropdown__menu__option__content_"]',
    );
  if (!option) return;
  event.preventDefault();
  event.stopPropagation();
  option.click();
}

/** A value-picking menu behind a textual trigger: no option icons, the current value in bold. */
export function TextDropdown({
  name,
  value,
  options,
  onChange,
  uiLocale,
}: TextDropdownProps) {
  const currentLabel =
    options.find((option) => option.value === value)?.label ?? value;
  return (
    <Dropdown
      renderTrigger={({ open, onClick }) => (
        <button
          type="button"
          className="blc-text-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${name}: ${currentLabel}`}
          onClick={onClick}
        >
          <span className="blc-text-trigger__label">{currentLabel}</span>
          {open ? <CaretUpIcon /> : <CaretDownIcon />}
        </button>
      )}
    >
      <div style={{ display: 'contents' }} onKeyDownCapture={pickHighlighted}>
        <DropdownMenu alignment="left">
          {options.flatMap((option) => {
            const item = (
              <DropdownOption
                key={`option:${option.value}`}
                active={option.value === value}
                onClick={() => onChange(option.value)}
              >
                {option.label}
                {option.count !== undefined && (
                  <span className="blc-option-count">
                    {option.count.toLocaleString(uiLocale)}
                  </span>
                )}
              </DropdownOption>
            );
            return option.separatorAfter
              ? [item, <DropdownSeparator key={`separator:${option.value}`} />]
              : [item];
          })}
        </DropdownMenu>
      </div>
    </Dropdown>
  );
}
