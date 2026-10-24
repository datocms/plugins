import Callout from 'datocms-react-ui/Callout';
import CardList from 'datocms-react-ui/CardList';
import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useState } from 'react';
import { isStoreUsable } from '../../lib/parameters';
import {
  describeError,
  getShopifyClient,
  type ShopifyClient,
} from '../../lib/shopifyClient';
import type {
  FieldScope,
  ShopifyKind,
  StoreCapabilities,
  StoreConnection,
} from '../../types';
import type { AsyncValue } from '../shared/useAsyncValue';
import { scopeSummary } from './draft';
import styles from './FieldSettings.module.css';
import { CalloutWithAction } from './notices';
import {
  CollectionField,
  ProductTypeField,
  type TagFilterSupport,
  type TagsAccess,
  TagsField,
} from './ScopeSelects';
import {
  type CollectionCheck,
  useCapabilityCheck,
  useCollectionCheck,
  useCollectionSearch,
  useStoreFilterValues,
} from './useShopifyOptions';

type ScopeChange = (patch: Partial<FieldScope>) => void;

type Props = {
  kind: ShopifyKind;
  scope: FieldScope | undefined;
  /** The field's store, or null when the plugin has no usable connection. */
  store: StoreConnection | null;
  error?: string;
  onChange: ScopeChange;
};

function sectionHint(kind: ShopifyKind): string {
  return kind === 'variant'
    ? 'Editors only see variants of matching products, with these limits shown as locked filters in the picker.'
    : 'Editors only see matching products, with these limits shown as locked filters in the picker.';
}

/**
 * 5. "Limit choices": one item of a card that opens on its fields (open when
 * limits are set). While the host flags the limits, the item stays open so
 * the error can't hide. The collection, product type and tag lists load from
 * the field's store only once the item is open.
 */
export default function ScopeSection({
  kind,
  scope,
  store,
  error,
  onChange,
}: Props) {
  const [open, setOpen] = useState(() => Boolean(scope || error));
  const [errorSeen, setErrorSeen] = useState(error);
  if (error !== errorSeen) {
    setErrorSeen(error);
    if (error) setOpen(true);
  }
  const summary = scopeSummary(scope);
  const row = {
    summary: (
      <EntityRow layout="row" title="Limit choices">
        {summary.length > 0 ? summary.join(' · ') : 'No limits'}
      </EntityRow>
    ),
  };
  const body = (
    <>
      <p className={styles.block}>{sectionHint(kind)}</p>
      {error && <Callout tone="danger">{error}</Callout>}
      <ScopeFields store={store} scope={scope} onChange={onChange} />
    </>
  );
  return (
    <div className={styles.block}>
      <CardList>
        {error ? (
          <CardList.Item row={row} body={body} />
        ) : (
          <CardList.Item
            row={row}
            expandable={{
              open,
              onToggle: () => setOpen((value) => !value),
              body,
            }}
          />
        )}
      </CardList>
    </div>
  );
}

function ScopeFields({
  store,
  scope,
  onChange,
}: {
  store: StoreConnection | null;
  scope: FieldScope | undefined;
  onChange: ScopeChange;
}) {
  const client = store && isStoreUsable(store) ? getShopifyClient(store) : null;
  return (
    <>
      {client && store ? (
        <StoreScopeFields
          client={client}
          store={store}
          scope={scope}
          onChange={onChange}
        />
      ) : (
        <Callout>
          Connect a Shopify store in the plugin settings to limit choices by
          collection, product type or tag.
        </Callout>
      )}
      <VendorField value={scope?.vendor} onChange={onChange} />
      <AvailableOnlyField
        value={scope?.availableOnly === true}
        onChange={onChange}
      />
    </>
  );
}

function AvailableOnlyField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: ScopeChange;
}) {
  return (
    <FieldWrapper
      id="scope-available"
      hint="The picker hides sold-out products."
    >
      <SwitchInput
        name="scope-available"
        label="Only show products available for sale"
        value={value}
        onChange={(availableOnly) =>
          onChange({ availableOnly: availableOnly || undefined })
        }
      />
    </FieldWrapper>
  );
}

/** The first failed lookup's message, if any. */
function loadError(...results: Array<AsyncValue<unknown>>): string | null {
  for (const result of results) {
    if (result.status === 'error') return describeError(result.error);
  }
  return null;
}

/** The check for the collection limited now (a stale one is ignored). */
function currentCheck(
  check: AsyncValue<CollectionCheck>,
  collectionId: string | undefined,
): CollectionCheck | null {
  const ready = check.status === 'ready' ? check.value : null;
  return ready && ready.collectionId === collectionId ? ready : null;
}

function tagsAccess(
  store: StoreConnection,
  granted: boolean,
  check: AsyncValue<StoreCapabilities>,
): TagsAccess {
  if (store.tokenless) return 'tokenless';
  if (granted) return 'granted';
  if (check.status === 'loading') return 'checking';
  if (check.status === 'error') return 'unknown';
  return 'denied';
}

function tagFilterSupport(
  collectionId: string | undefined,
  check: CollectionCheck | null,
): TagFilterSupport {
  if (!collectionId) return 'applies';
  if (!check?.found) return 'unknown';
  return check.support.tag ? 'applies' : 'ignored';
}

/**
 * The lists that come from the store; one error (with a retry under it) for
 * every lookup, including the background check of a store saved without
 * capabilities.
 */
function StoreScopeFields({
  client,
  store,
  scope,
  onChange,
}: {
  client: ShopifyClient;
  store: StoreConnection;
  scope: FieldScope | undefined;
  onChange: ScopeChange;
}) {
  const capabilityCheck = useCapabilityCheck(client);
  const filters = useStoreFilterValues(client);
  const [search, setSearch] = useState('');
  const collections = useCollectionSearch(client, search);
  const collectionId = scope?.collectionId;
  const check = currentCheck(
    useCollectionCheck(client, collectionId),
    collectionId,
  );
  const lookups = [capabilityCheck, collections, filters];
  const error = loadError(...lookups);
  const retry = () => {
    for (const lookup of lookups) {
      if (lookup.status === 'error') lookup.reload();
    }
  };
  return (
    <>
      {error && (
        <CalloutWithAction
          tone="danger"
          title="Couldn't load the lists from Shopify"
          action={{ label: 'Try again', onClick: retry }}
        >
          {error}
        </CalloutWithAction>
      )}
      <CollectionField
        collections={collections}
        search={search}
        onSearch={setSearch}
        scope={scope}
        missing={check?.found === false}
        onChange={onChange}
      />
      <ProductTypeField filters={filters} scope={scope} onChange={onChange} />
      <TagsField
        filters={filters}
        scope={scope}
        onChange={onChange}
        access={tagsAccess(
          store,
          client.effectiveCapabilities().tags,
          capabilityCheck,
        )}
        support={tagFilterSupport(collectionId, check)}
      />
    </>
  );
}

/**
 * Shopify's `vendor:` search, and the picker's check that mirrors it, match
 * whole words case-insensitively, not the exact name.
 */
const VENDOR_HINT =
  'Editors only see products from this vendor. Shopify matches whole words, so "Acme" also matches "Acme Outlet".';

/** Free text (Shopify has no vendor list); keeps what's typed, writes it trimmed. */
function VendorField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: ScopeChange;
}) {
  const saved = value ?? '';
  const [text, setText] = useState(saved);
  const [syncedWith, setSyncedWith] = useState(saved);
  if (saved !== syncedWith) {
    setSyncedWith(saved);
    if (saved !== text.trim()) setText(saved);
  }
  return (
    <FieldWrapper id="scope-vendor" label="Vendor" hint={VENDOR_HINT}>
      <StringInput
        name="scope-vendor"
        placeholder="Acme"
        autoComplete="off"
        value={text}
        onChange={(next) => {
          const typed = next ?? '';
          setText(typed);
          onChange({ vendor: typed.trim() || undefined });
        }}
      />
    </FieldWrapper>
  );
}
