import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import InfoList from 'datocms-react-ui/InfoList';
import type { StoreCapabilities } from '../../types';
import { PERMISSIONS } from './permissions';
import styles from './Settings.module.css';

/*
 * Only what the plugin uses, named after what editors get: the picker's tag
 * filters, and the stock levels of products and variants. Metafields aren't
 * listed: nothing reads them in 2.0, and Shopify answers the probe the same
 * way with or without the scope.
 *
 * Detection can't tell a missing scope from missing data: Shopify answers an
 * empty tag list (or no product at all) either way. Each hint covers both,
 * in one sentence (a note under the value).
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
 * An `InfoList` row per missing capability, with how to get it. What's
 * available needs nothing from anyone, so it doesn't show.
 */
export default function CapabilityList({ capabilities, tokenless }: Props) {
  return (
    <>
      {CAPABILITIES.filter(({ name }) => !capabilities[name]).map(
        ({ name, label, hint, tokenlessHint }) => (
          <InfoList.Row key={name} title={label}>
            <FeedbackDot tone="neutral" /> Not available
            <span className={styles.note}>
              {tokenless ? tokenlessHint : hint}
            </span>
          </InfoList.Row>
        ),
      )}
    </>
  );
}
