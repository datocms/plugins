import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import SettingsList from 'datocms-react-ui/SettingsList';
import type { StoreCapabilities } from '../../types';
import { PERMISSIONS } from './permissions';

/*
 * Only what the plugin uses. Metafields aren't listed: nothing reads them in
 * 2.0, and Shopify answers the probe the same way with or without the scope.
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
    label: 'Tags',
    hint: `Enable "${PERMISSIONS.tags.label}" in Headless → Storefront API permissions, or tag some products.`,
    tokenlessHint: 'Tags need a Storefront access token.',
  },
  {
    name: 'inventory',
    label: 'Inventory',
    hint: `Enable "${PERMISSIONS.inventory.label}" in Headless → Storefront API permissions, or publish some products to this storefront.`,
    tokenlessHint: 'Inventory needs a Storefront access token.',
  },
];

type Props = {
  capabilities: StoreCapabilities;
  tokenless: boolean;
};

/**
 * One `SettingsList` row per capability: available or not, and how to get
 * what's missing.
 */
export default function CapabilityList({ capabilities, tokenless }: Props) {
  return (
    <>
      {CAPABILITIES.map(({ name, label, hint, tokenlessHint }) => {
        const granted = capabilities[name];
        return (
          <SettingsList.Row
            key={name}
            title={label}
            value={
              <>
                <FeedbackDot tone={granted ? 'success' : 'neutral'} />{' '}
                {granted ? 'Available' : 'Not available'}
              </>
            }
            description={granted ? undefined : tokenless ? tokenlessHint : hint}
          />
        );
      })}
    </>
  );
}
