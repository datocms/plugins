import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';

export type FilterDropdownOption = {
  label: string;
  value: string;
};

export type FilterDropdownProps = {
  /** What the menu filters, for example "Filter by model" */
  tooltip: string;
  value: string;
  /** The first option is the one without a filter ("All models") */
  options: readonly FilterDropdownOption[];
  onChange: (value: string) => void;
  disabled?: { reason: string };
};

/** A menu of choices in the title bar: the trigger shows the current value. */
export function FilterDropdown({
  tooltip,
  value,
  options,
  onChange,
  disabled,
}: FilterDropdownProps) {
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Dropdown
      triggerComponent={ButtonTrigger}
      tone="ghost"
      label={selected?.label ?? value}
      tooltip={tooltip}
      disabled={disabled}
    >
      {/* The filters sit at the right end of the title bar */}
      <Dropdown.Menu placement="bottom-end">
        {options.map((option) => (
          <Dropdown.Option
            key={option.value || '__all__'}
            active={option.value === (selected?.value ?? value)}
            onPick={() => onChange(option.value)}
          >
            {option.label}
          </Dropdown.Option>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
