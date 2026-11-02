import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import SettingsList from 'datocms-react-ui/SettingsList';
import type { StoreCapabilities } from '../../types';
import { PERMISSIONS } from './permissions';

/*
 * Only what the plugin uses, named after what editors get: the picker's tag
 * filters, and the stock levels of products and variants. Metafields aren't
 * listed: nothing reads them in 2.0, and Shopify answers the probe the same
 * way with or without the scope.
 *
 * Detection can't tell a missing scope from missing data: Shopify answers an
 * empty tag list (or no product at all) either way. Each hint covers both,
 * in one sentence (a SettingsList description).
 */
const CAPABILITIES: Array<{
  name: 'tags' | 'inventory';
  label: string;
  hint: string;
  tokenlessHint: string;
}> = [
  {
    name: 'tags',
    label: 'Tag filters',
    hint: `Enable "${PERMISSIONS.tags.label}" in Headless → Storefront API permissions, or tag some products.`,
    tokenlessHint: 'Tag filters need a Storefront access token.',
  },
  {
    name: 'inventory',
    label: 'Stock levels',
    hint: `Enable "${PERMISSIONS.inventory.label}" in Headless → Storefront API permissions, or publish some products to this storefront.`,
    tokenlessHint: 'Stock levels need a Storefront access token.',
  },
];

type Props = {
  capabilities: StoreCapabilities;
  tokenless: boolean;
};

/**
 * A `SettingsList` row per missing capability, with how to get it. What's
 * available needs nothing from anyone, so it doesn't show.
 */
export default function CapabilityList({ capabilities, tokenless }: Props) {
  return (
    <>
      {CAPABILITIES.filter(({ name }) => !capabilities[name]).map(
        ({ name, label, hint, tokenlessHint }) => (
          <SettingsList.Row
            key={name}
            title={label}
            value={
              <>
                <FeedbackDot tone="neutral" /> Not available
              </>
            }
            description={tokenless ? tokenlessHint : hint}
          />
        ),
      )}
    </>
  );
}
