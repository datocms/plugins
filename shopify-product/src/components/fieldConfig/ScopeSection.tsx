import { faCaretRight } from '@fortawesome/free-solid-svg-icons';
import {
  FieldError,
  FieldHint,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
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
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import Callout from '../shared/Callout';
import type { AsyncValue } from '../shared/useAsyncValue';
import { describe } from './describe';
import { scopeSummary } from './draft';
import {
  CollectionField,
  ProductTypeField,
  type TagFilterSupport,
  type TagsAccess,
  TagsField,
} from './ScopeSelects';
import styles from './ScopeSection.module.css';
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

const BODY_ID = 'limit-choices-fields';

function sectionHint(kind: ShopifyKind): string {
  return kind === 'variant'
    ? 'Editors only see variants of matching products, with these limits shown as locked filters in the picker'
    : 'Editors only see matching products, with these limits shown as locked filters in the picker';
}

/**
 * 5. "Limit choices": a collapsible group (open when limits are set). The
 * collection, product type and tag lists load from the field's store only
 * once the group is open.
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
  const described = describe('limit-choices', sectionHint(kind), error);

  return (
    <div>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={open ? BODY_ID : undefined}
        aria-describedby={described.ids}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon icon={faCaretRight} className={styles.caret} />
        <span className={error ? styles.titleError : styles.title}>
          Limit choices
        </span>
        <span className={styles.summary}>
          {summary.length > 0 ? summary.join(' · ') : 'No limits'}
        </span>
      </button>
      {described.error && <FieldError>{described.error}</FieldError>}
      <FieldHint>{described.hint}</FieldHint>
      {open && (
        <div id={BODY_ID} className={styles.body}>
          <ScopeFields store={store} scope={scope} onChange={onChange} />
        </div>
      )}
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
        <Callout tone="neutral">
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
  const described = describe(
    'scope-available',
    'If enabled, sold-out products are hidden from the picker',
    undefined,
  );
  return (
    <div>
      <SwitchField
        id="scope-available"
        name="scope-available"
        label="Only show products available for sale?"
        hint={described.hint}
        value={value}
        onChange={(availableOnly) =>
          onChange({ availableOnly: availableOnly || undefined })
        }
        switchInputProps={{
          name: 'scope-available',
          value,
          'aria-describedby': described.ids,
        }}
      />
    </div>
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
 * The lists that come from the store; one error (with a retry) for every
 * lookup, including the background check of a store saved without
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
        <Callout
          tone="danger"
          role="alert"
          title="Couldn't load the lists from Shopify"
          actions={
            <Button buttonSize="xxs" onClick={retry}>
              Try again
            </Button>
          }
        >
          {error}
        </Callout>
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
  const described = describe('scope-vendor', VENDOR_HINT, undefined);
  return (
    <div>
      <TextField
        id="scope-vendor"
        name="scope-vendor"
        label="Vendor"
        hint={described.hint}
        value={text}
        onChange={(next) => {
          setText(next);
          onChange({ vendor: next.trim() || undefined });
        }}
        textInputProps={{
          autoComplete: 'off',
          'aria-describedby': described.ids,
        }}
      />
    </div>
  );
}
