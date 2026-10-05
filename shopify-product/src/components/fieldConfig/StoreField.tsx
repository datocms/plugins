import { FieldWrapper, SelectInput } from 'datocms-react-ui';
import { storeLabel } from '../../lib/parameters';
import type { StoreConnection } from '../../types';
import { describe, useInputDescription } from './describe';
import styles from './ScopeSection.module.css';

/** `named`: the store has a label of its own, so the menu adds its domain. */
type Option = { value: string; label: string; domain: string; named: boolean };

type Props = {
  stores: StoreConnection[];
  /** The resolved store, or null when the saved one is no longer configured. */
  store: StoreConnection | null;
  /** The field's saved `shopDomain`, if any. */
  shopDomain: string | undefined;
  error?: string;
  onChange: (shopDomain: string) => void;
};

/** The first store is the default for fields without a store of their own. */
function toOption(store: StoreConnection, index: number): Option {
  const label = storeLabel(store);
  return {
    value: store.shopDomain,
    label: index === 0 ? `${label} (default)` : label,
    domain: store.shopDomain,
    named: label !== store.shopDomain,
  };
}

function OptionLabel(option: Option, meta: { context: 'menu' | 'value' }) {
  if (meta.context === 'value' || !option.named) {
    return option.label;
  }
  return (
    <span className={styles.option}>
      <span>{option.label}</span>
      <span className={styles.optionHint}>{option.domain}</span>
    </span>
  );
}

/** 6. Which store editors browse. Only rendered with more than one store. */
export default function StoreField({
  stores,
  store,
  shopDomain,
  error,
  onChange,
}: Props) {
  const options = stores.map(toOption);
  const value = store
    ? (options.find((option) => option.value === store.shopDomain) ?? null)
    : null;
  const missing =
    shopDomain && !store
      ? `${shopDomain} isn't in the plugin settings anymore: choose another store`
      : undefined;
  const described = describe(
    'store',
    'Editors browse this store. The default is the first store in the plugin settings.',
    error ?? missing,
  );
  useInputDescription('store', described.ids);
  return (
    <div>
      <FieldWrapper
        id="store"
        label="Store"
        error={described.error}
        hint={described.hint}
      >
        <SelectInput<Option, false>
          inputId="store"
          value={value}
          options={options}
          error={Boolean(described.invalid)}
          aria-invalid={described.invalid}
          placeholder="Select a store…"
          formatOptionLabel={OptionLabel}
          onChange={(option) => {
            if (option) onChange(option.value);
          }}
        />
      </FieldWrapper>
    </div>
  );
}
