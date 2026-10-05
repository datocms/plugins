import { SwitchField } from 'datocms-react-ui';

type Props = {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
};

/** "Use the demo store?" (the screen's top notice says when it's on). */
export default function DemoStoreSection({ value, disabled, onChange }: Props) {
  // SwitchField renders more than one root element: keep it in one box.
  return (
    <div>
      <SwitchField
        id="useDemoStore"
        name="useDemoStore"
        label="Use the demo store?"
        hint="Browse sample products without a Shopify account"
        value={value}
        onChange={onChange}
        switchInputProps={{ name: 'useDemoStore', value, disabled }}
      />
    </div>
  );
}
