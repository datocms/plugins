import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SwitchInput from 'datocms-react-ui/SwitchInput';

type Props = {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
};

/** "Use the demo store" (the screen's top notice says when it's on). */
export default function DemoStoreSection({ value, disabled, onChange }: Props) {
  return (
    <FieldWrapper
      id="useDemoStore"
      hint="Browse sample products without a Shopify account."
    >
      <SwitchInput
        name="useDemoStore"
        label="Use the demo store"
        value={value}
        disabled={disabled}
        onChange={(on) => onChange(Boolean(on))}
      />
    </FieldWrapper>
  );
}
