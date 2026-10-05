import {
  faCircleCheck,
  faCircleXmark,
} from '@fortawesome/free-regular-svg-icons';
import type { StoreCapabilities } from '../../types';
import { Icon } from '../../ui/Icon';
import styles from './ConnectionStatus.module.css';
import { PERMISSIONS } from './permissions';

/*
 * Only what the plugin uses. Metafields aren't listed: nothing reads them in
 * 2.0, and Shopify answers the probe the same way with or without the scope.
 *
 * Detection can't tell a missing scope from missing data: Shopify answers an
 * empty tag list (or no product at all) either way. The hints cover both.
 */
const CAPABILITIES: Array<{
  name: 'tags' | 'inventory';
  label: string;
  hint: string;
}> = [
  {
    name: 'tags',
    label: 'Tags',
    hint: `Enable "${PERMISSIONS.tags.label}" in Headless → Storefront API permissions to filter by tag. If it's already on, none of the products on this storefront has tags yet.`,
  },
  {
    name: 'inventory',
    label: 'Inventory',
    hint: `Enable "${PERMISSIONS.inventory.label}" in Headless → Storefront API permissions to show stock. If it's already on, publish some products to this storefront.`,
  },
];

const TOKENLESS_HINT = 'Tags and inventory need a Storefront access token';

/** How to get what's missing: one line per scope, or one for tokenless stores. */
function unlockHints(
  capabilities: StoreCapabilities,
  tokenless: boolean,
): string[] {
  const missing = CAPABILITIES.filter(({ name }) => !capabilities[name]);
  if (missing.length === 0) return [];
  return tokenless ? [TOKENLESS_HINT] : missing.map(({ hint }) => hint);
}

type Props = {
  capabilities: StoreCapabilities;
  tokenless: boolean;
  /** Short date shown when the capabilities come from the saved settings. */
  checkedOn: string | null;
};

/** "✓ Tags ✗ Inventory", plus how to unlock what's missing. */
export default function CapabilityList({
  capabilities,
  tokenless,
  checkedOn,
}: Props) {
  const hints = unlockHints(capabilities, tokenless);

  return (
    <div className={styles.capabilities}>
      <div className={styles.capabilityRow}>
        <ul className={styles.capabilityList} aria-label="Capabilities">
          {CAPABILITIES.map(({ name, label }) => {
            const granted = capabilities[name];
            return (
              <li
                key={name}
                className={granted ? styles.granted : styles.missing}
              >
                <Icon icon={granted ? faCircleCheck : faCircleXmark} />
                {label}
                <span className="dl-sr-only">
                  {granted ? ': available' : ': not available'}
                </span>
              </li>
            );
          })}
        </ul>
        {checkedOn && (
          <span className={styles.checkedOn}>Checked on {checkedOn}</span>
        )}
      </div>
      {hints.length > 0 && (
        <ul className={styles.hints}>
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
