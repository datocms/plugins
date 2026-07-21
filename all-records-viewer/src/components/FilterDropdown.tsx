import {
  CaretDownIcon,
  CaretUpIcon,
  Dropdown,
  DropdownMenu,
  DropdownOption,
} from 'datocms-react-ui';
import styles from './FilterDropdown.module.css';

export type FilterDropdownOption = {
  label: string;
  value: string;
};

export type FilterDropdownProps = {
  ariaLabel: string;
  value: string;
  options: readonly FilterDropdownOption[];
  onChange: (value: string) => void;
  alignment?: 'left' | 'right';
  disabled?: boolean;
};

export function FilterDropdown({
  ariaLabel,
  value,
  options,
  onChange,
  alignment = 'left',
  disabled = false,
}: FilterDropdownProps) {
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Dropdown
      renderTrigger={({ open, onClick }) => (
        <button
          type="button"
          className={styles.trigger}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={onClick}
        >
          <span>{selected?.label ?? value}</span>
          {open ? <CaretUpIcon /> : <CaretDownIcon />}
        </button>
      )}
    >
      <DropdownMenu alignment={alignment}>
        {options.map((option) => (
          <DropdownOption
            key={option.value || '__all__'}
            active={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownOption>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
