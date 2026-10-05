import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { useEffect, useRef } from 'react';
import FieldConfigScreen from '../../src/entrypoints/FieldConfigScreen';
import { validateFieldParameters } from '../../src/lib/parameters';
import { DEMO_STORE, type StoreConnection } from '../../src/types';
import type { CtxBuilder } from '../surface';
import { defineSurface } from '../surface';

/**
 * The per-field settings in the field modal's Presentation tab. States cover
 * new and 1.x fields, every format, limits, stores and the warnings.
 */

const CAPABILITIES = {
  tags: true,
  inventory: false,
  metafields: false,
  checkedAt: '2026-10-03T12:00:00Z',
};

/** The demo store as a regular connection, with the tags capability. */
const EU_STORE: StoreConnection = {
  ...DEMO_STORE,
  label: 'EU store',
  capabilities: CAPABILITIES,
};

const US_STORE: StoreConnection = {
  shopDomain: 'acme-us.myshopify.com',
  storefrontAccessToken: '00000000000000000000000000000000',
  tokenless: false,
  label: 'US store',
  capabilities: CAPABILITIES,
};

/** The demo store saved without capabilities: the settings check it live. */
const { capabilities: _checked, ...UNCHECKED_STORE } = EU_STORE;

/** A tokenless connection: tags need a token. */
const TOKENLESS_STORE: StoreConnection = {
  ...UNCHECKED_STORE,
  storefrontAccessToken: '',
  tokenless: true,
};

/** A store Shopify doesn't know: every lookup fails. */
const MISSING_STORE: StoreConnection = {
  shopDomain: 'datocms-no-such-store-7f3a9c.myshopify.com',
  storefrontAccessToken: '00000000000000000000000000000000',
  tokenless: false,
  capabilities: CAPABILITIES,
};

function pluginParameters(stores: StoreConnection[]) {
  return {
    paramsVersion: '3',
    stores,
    useDemoStore: false,
    autoApplyToFieldsWithApiKey: '',
  };
}

const ONE_STORE = pluginParameters([EU_STORE]);

const REFERENCE = {
  paramsVersion: '1',
  kind: 'product',
  cardinality: 'single',
  format: 'reference',
  snapshot: false,
};

/** A field the developer is creating: no ID yet. */
function NewField({ ctx }: { ctx: CtxBuilder<'fieldConfig'> }) {
  const base = ctx();
  const { id: _id, ...pendingField } = base.pendingField;
  return <FieldConfigScreen ctx={ctx({ pendingField })} />;
}

/** Simulates the developer changing a saved field's settings (before saving). */
function PendingChange({
  ctx,
  next,
}: {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
  next: Record<string, unknown>;
}) {
  const changed = useRef(false);
  useEffect(() => {
    if (changed.current) return;
    changed.current = true;
    window.setTimeout(() => void ctx.setParameters(next), 50);
  });
  return (
    <>
      {/* Headless screenshots freeze CSS transitions started after load. */}
      <style>{'* { transition: none !important; }'}</style>
      <FieldConfigScreen ctx={ctx} />
    </>
  );
}

/** What the pending-change states switch to after mounting. */
const PENDING_CHANGES: Record<string, Record<string, unknown>> = {
  'format-change': { ...REFERENCE },
  'store-change': { ...REFERENCE, shopDomain: US_STORE.shopDomain },
  'cardinality-change': { ...REFERENCE },
};

export default defineSurface({
  id: 'fieldConfig',
  title: 'Field settings',
  kind: 'fieldConfig',
  description:
    'renderManualFieldExtensionConfigScreen: the per-field settings box in the field modal.',
  validate: (parameters) => validateFieldParameters(parameters),
  states: {
    'new-json': {
      description:
        'A JSON field being created: the 2.0 defaults (reference document) are written once.',
      pluginParameters: ONE_STORE,
    },
    'legacy-json': {
      description:
        'A saved 1.x JSON field (no parameters): legacy product JSON, nothing written.',
      pluginParameters: ONE_STORE,
    },
    'legacy-string': {
      description: 'A saved 1.x string field: product handle, nothing written.',
      fieldType: 'string',
      pluginParameters: ONE_STORE,
    },
    'string-gid-variant': {
      description: 'A string field storing variant Shopify IDs.',
      fieldType: 'string',
      pluginParameters: ONE_STORE,
      fieldParameters: {
        paramsVersion: '1',
        kind: 'variant',
        cardinality: 'single',
        format: 'gid',
        snapshot: false,
      },
    },
    'multiple-limits-error': {
      description:
        'Multiple products with min greater than max: the validator error shows under Minimum.',
      pluginParameters: ONE_STORE,
      fieldParameters: {
        ...REFERENCE,
        cardinality: 'multiple',
        min: 5,
        max: 2,
      },
    },
    snapshot: {
      description: 'Multiple variants with the display snapshot on.',
      pluginParameters: ONE_STORE,
      fieldParameters: {
        ...REFERENCE,
        kind: 'variant',
        cardinality: 'multiple',
        snapshot: true,
        max: 4,
      },
    },
    'limit-collection': {
      description:
        'Products limited to a collection, a product type, tags and availability (live lists).',
      pluginParameters: ONE_STORE,
      fieldParameters: {
        ...REFERENCE,
        cardinality: 'multiple',
        scope: {
          collectionId: 'gid://shopify/Collection/645261132122',
          collectionTitle: 'Hydrogen',
          productType: 'snowboard',
          tags: ['Premium', 'Winter'],
          availableOnly: true,
        },
      },
    },
    'limit-collection-missing': {
      description:
        'Limited to a collection the storefront no longer sees: the Collection select warns.',
      pluginParameters: ONE_STORE,
      fieldParameters: {
        ...REFERENCE,
        cardinality: 'multiple',
        scope: {
          collectionId: 'gid://shopify/Collection/1',
          collectionTitle: 'Retired collection',
        },
      },
    },
    'two-stores': {
      description: 'Two stores configured: the Store select appears.',
      pluginParameters: pluginParameters([EU_STORE, US_STORE]),
      fieldParameters: REFERENCE,
    },
    'store-unreachable': {
      description:
        'The store answers with an error: the collection and product type lists show it with a retry.',
      pluginParameters: pluginParameters([MISSING_STORE]),
      fieldParameters: { ...REFERENCE, scope: { availableOnly: true } },
    },
    'tags-unchecked': {
      description:
        'A store saved without capabilities (its migration check failed): Limit choices checks the token live before offering Tags.',
      pluginParameters: pluginParameters([UNCHECKED_STORE]),
      fieldParameters: { ...REFERENCE, scope: { availableOnly: true } },
    },
    tokenless: {
      description:
        'A store connected without a token: Tags asks for one instead of a permission.',
      pluginParameters: pluginParameters([TOKENLESS_STORE]),
      fieldParameters: { ...REFERENCE, scope: { availableOnly: true } },
    },
    'demo-store': {
      description:
        'Demo mode: the demo store comes with its capabilities, so Tags is offered at once.',
      pluginParameters: { ...pluginParameters([]), useDemoStore: true },
      fieldParameters: { ...REFERENCE, scope: { availableOnly: true } },
    },
    'not-configured': {
      description:
        'No store connection: Limit choices shows a hint instead of the lists.',
      pluginParameters: pluginParameters([]),
      fieldParameters: { ...REFERENCE, scope: { vendor: 'Snowboard Vendor' } },
    },
    'format-change': {
      description:
        'A saved 1.x JSON field switched to reference documents: the transition warning.',
      pluginParameters: ONE_STORE,
    },
    'store-change': {
      description:
        'A saved field moved from the EU store to the US store: existing references point to the old one.',
      pluginParameters: pluginParameters([EU_STORE, US_STORE]),
      fieldParameters: REFERENCE,
    },
    'cardinality-change': {
      description:
        'A saved multiple-products field switched back to one: lists no longer fit.',
      pluginParameters: ONE_STORE,
      fieldParameters: { ...REFERENCE, cardinality: 'multiple', max: 4 },
    },
    'invalid-combination': {
      description:
        'A string field saved through the API as variant handles: the corrected settings and a one-click fix.',
      fieldType: 'string',
      pluginParameters: ONE_STORE,
      fieldParameters: { ...REFERENCE, kind: 'variant', format: 'handle' },
    },
    'unsupported-version': {
      description: 'Saved settings from an unknown version: left untouched.',
      pluginParameters: ONE_STORE,
      fieldParameters: { paramsVersion: '9', kind: 'product' },
    },
  },
  render: (ctx, state) => {
    if (state.name === 'new-json') return <NewField ctx={ctx} />;
    const pending = PENDING_CHANGES[state.name];
    if (pending) return <PendingChange ctx={ctx()} next={pending} />;
    return <FieldConfigScreen ctx={ctx()} />;
  },
});
