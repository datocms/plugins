import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import { storeLabel } from '../../lib/parameters';
import type { StoreConnection } from '../../types';
import { MAX_RADIO_OPTIONS } from '../shared/choices';
import { STORE_CHANGE_TITLE } from './copy';
import { fieldNotice } from './notices';

/** `domain`: the store has a label of its own, so the menu adds its domain. */
type Option = { value: string; label: string; domain?: string };

type Props = {
  stores: StoreConnection[];
  /** The resolved store, or null when the saved one is no longer configured. */
  store: StoreConnection | null;
  /** The field's saved `shopDomain`, if any. */
  shopDomain: string | undefined;
  /**
   * A store the field points to, or pointed to when it was saved, that the
   * plugin settings no longer have: it stays in the list, disabled, so the
   * saved choice shows (like a market Shopify no longer offers).
   */
  removedDomain: string | null;
  error?: string;
  /** The warning about saved values that point to the previous store. */
  notice: string | null;
  onChange: (shopDomain: string) => void;
};

/** The first store is the default for fields without a store of their own. */
function toOption(store: StoreConnection, index: number): Option {
  const label = storeLabel(store);
  return {
    value: store.shopDomain,
    label: index === 0 ? `${label} (default)` : label,
    domain: label === store.shopDomain ? undefined : store.shopDomain,
  };
}

function formatOptionLabel(
  option: Option,
  meta: { context: 'menu' | 'value' },
) {
  if (meta.context === 'value' || !option.domain) return option.label;
  return (
    <EntityRow layout="row" title={option.label}>
      {option.domain}
    </EntityRow>
  );
}

const REMOVED_REASON = "This store isn't in the plugin settings anymore.";

function removedLabel(domain: string): string {
  return `${domain} (removed)`;
}

/**
 * 6. Which store editors browse: with several stores, or a store to fix.
 * A few stores show as radios (a labelled store has its domain as the
 * hint, a removed one is disabled); more go in a select.
 */
export default function StoreField({
  stores,
  store,
  shopDomain,
  removedDomain,
  error,
  notice,
  onChange,
}: Props) {
  const missing =
    shopDomain && !store
      ? `${shopDomain} isn't in the plugin settings anymore. Choose another store.`
      : undefined;
  const options = stores.map(toOption);
  // A field whose store was removed keeps showing it as its value.
  const value = store?.shopDomain ?? shopDomain ?? null;
  const change = (domain: string | null) => {
    if (domain) onChange(domain);
  };
  return (
    <FieldWrapper
      id="store"
      label="Store"
      hint="Editors browse this store. The default is the first store in the plugin settings."
      error={error ?? missing}
      container={fieldNotice(notice, STORE_CHANGE_TITLE)}
    >
      {options.length <= MAX_RADIO_OPTIONS ? (
        <RadioGroupInput
          name="store"
          value={value}
          options={[
            ...options.map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.domain,
            })),
            ...(removedDomain
              ? [
                  {
                    value: removedDomain,
                    label: removedLabel(removedDomain),
                    disabled: true,
                    tooltip: REMOVED_REASON,
                  },
                ]
              : []),
          ]}
          onChange={change}
        />
      ) : (
        <SelectInput
          name="store"
          value={value}
          options={options}
          clearable={false}
          placeholder="Select a store"
          acceptValueNotIncludedInOptions={(domain: string) => ({
            value: domain,
            label: removedLabel(domain),
          })}
          formatOptionLabel={formatOptionLabel}
          onChange={change}
        />
      )}
    </FieldWrapper>
  );
}
