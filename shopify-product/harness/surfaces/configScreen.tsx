import { type ReactNode, useEffect } from 'react';
import { ADVANCED_TOGGLE_ID } from '../../src/components/settings/AdvancedSettings';
import ConfigScreen from '../../src/entrypoints/ConfigScreen';
import { DEMO_STORE, type StoreConnection } from '../../src/types';
import connectionTestFixture from '../../tests/fixtures/storefront-connection-test.json';
import { defineSurface } from '../surface';

/**
 * The plugin config screen (`renderConfigScreen`). States that need an
 * interaction (typing, Save, Re-check) script it after mount, and states that
 * need a Shopify failure the demo store can't produce patch `fetch` in this
 * frame only. Everything else talks to the live demo store.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEMO_DOMAIN = DEMO_STORE.shopDomain;
const DEMO_TOKEN = DEMO_STORE.storefrontAccessToken;
const SECOND_DOMAIN = 'acme-eu.myshopify.com';
const THIRD_DOMAIN = 'acme-us.myshopify.com';

const demoConnection = (
  overrides: Partial<StoreConnection> = {},
): StoreConnection => ({
  shopDomain: DEMO_DOMAIN,
  storefrontAccessToken: DEMO_TOKEN,
  tokenless: false,
  capabilities: {
    tags: true,
    inventory: false,
    metafields: true,
    checkedAt: '2026-09-28T09:30:00.000Z',
  },
  ...overrides,
});

const v3 = (
  stores: StoreConnection[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  paramsVersion: '3',
  stores,
  useDemoStore: false,
  autoApplyToFieldsWithApiKey: '',
  ...extra,
});

// ---------------------------------------------------------------------------
// fetch patches (this frame only)
// ---------------------------------------------------------------------------

type FetchPatch = (
  original: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pendingUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });
}

/** Shopify answers, but reports the pinned version as unsupported. */
const expiredApiVersion: FetchPatch = async (original, input, init) => {
  const response = await original(input, init);
  const body = typeof init?.body === 'string' ? init.body : '';
  if (!body.includes('publicApiVersions')) return response;
  const json = await response.json();
  for (const version of json?.data?.publicApiVersions ?? []) {
    if (version.handle === '2026-10') version.supported = false;
  }
  return jsonResponse(json);
};

const FAKE_STORES: Record<string, string> = {
  [SECOND_DOMAIN]: 'Acme Europe',
  [THIRD_DOMAIN]: 'Acme US',
};

/**
 * Extra stores that answer like the demo store, under another name. Every
 * request gets the connection-test answer, so capability probes find no
 * tags and no inventory.
 */
const secondStore: FetchPatch = (original, input, init) => {
  const url = requestUrl(input);
  const domain = Object.keys(FAKE_STORES).find((key) => url.includes(key));
  if (!domain) return original(input, init);
  const body = structuredClone(connectionTestFixture.body);
  body.data.shop.name = FAKE_STORES[domain] ?? domain;
  body.data.shop.primaryDomain.url = `https://${domain}`;
  return Promise.resolve(jsonResponse(body));
};

/** Shopify answers 401, as it does for a mistyped or foreign token. */
const rejectedToken: FetchPatch = (original, input, init) =>
  requestUrl(input).includes('myshopify.com')
    ? Promise.resolve(
        new Response(JSON.stringify({ errors: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    : original(input, init);

const FETCH_PATCHES: Record<string, FetchPatch> = {
  'network-error': (original, input, init) =>
    requestUrl(input).includes('myshopify.com')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : original(input, init),
  'wrong-token': rejectedToken,
  saving: (original, input, init) =>
    requestUrl(input).includes('myshopify.com')
      ? pendingUntilAborted(init)
      : original(input, init),
  'api-version-outdated': expiredApiVersion,
  'two-stores': secondStore,
  'store-menu': secondStore,
  'store-menu-keyboard': secondStore,
  'three-stores-removed': secondStore,
};

let patchedFor: string | null = null;

function patchFetch(state: string): void {
  const patch = FETCH_PATCHES[state];
  if (!patch || patchedFor === state) return;
  patchedFor = state;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => patch(original, input, init);
}

// ---------------------------------------------------------------------------
// Scripted interactions
// ---------------------------------------------------------------------------

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function input(selector: string, index = 0): HTMLInputElement | null {
  return document.querySelectorAll<HTMLInputElement>(selector)[index] ?? null;
}

/** Sets a value the way typing does, so React's onChange fires. */
function type(selector: string, value: string, index = 0): void {
  const element = input(selector, index);
  if (!element) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

function click(selector: string, index = 0): void {
  document.querySelectorAll<HTMLElement>(selector)[index]?.click();
}

/** A key press on the focused element (menus listen on the document). */
function press(key: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true }),
  );
}

function clickButton(label: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  button?.click();
}

const DOMAIN = 'input[id$="-domain"]';
const TOKEN = 'input[id$="-token"]';
const TOKENLESS = 'button[id$="-tokenless"]';
const SAVE = 'button[type="submit"]';
const ADVANCED = `#${ADVANCED_TOGGLE_ID}`;

type Step = () => void;

const SCRIPTS: Record<string, Step[]> = {
  'invalid-domain': [() => type(DOMAIN, 'www.acme-store.com')],
  'admin-token': [
    () => type(DOMAIN, 'https://admin.shopify.com/store/acme/products'),
    () => type(TOKEN, 'shpat_example-admin-token'),
  ],
  'tokenless-locked': [
    () => type(DOMAIN, 'datocms-demo'),
    () => clickButton('More options'),
    () => click(TOKENLESS),
    () => click(SAVE),
  ],
  'missing-token': [() => type(DOMAIN, 'acme'), () => click(SAVE)],
  'inventory-missing': [() => clickButton('Re-check')],
  'three-stores-removed': [
    () => click('button[aria-label="Actions for store 2"]'),
    () => clickButton('Remove store'),
  ],
  'store-menu': [() => click('button[aria-label="Actions for store 2"]')],
  'store-menu-keyboard': [
    () => click('button[aria-label="Actions for store 2"]'),
    () => press('ArrowDown'),
  ],
  'advanced-settings': [() => click(ADVANCED)],
  'more-options': [() => clickButton('More options')],
  saving: [
    () => click(ADVANCED),
    () => type('#autoApplyToFieldsWithApiKey', '^shopify_'),
    () => click(SAVE),
  ],
};

function Scripted({
  script,
  children,
}: {
  script: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const steps = SCRIPTS[script];
    if (!steps) return undefined;
    let cancelled = false;
    // One step every 150ms, so React re-renders between them.
    void steps.reduce(
      (previous, step) =>
        previous
          .then(() => wait(150))
          .then(() => {
            if (!cancelled) step();
          }),
      Promise.resolve(),
    );
    return () => {
      cancelled = true;
    };
  }, [script]);
  return children;
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export default defineSurface({
  id: 'config-screen',
  title: 'Plugin settings',
  kind: 'config',
  description:
    'renderConfigScreen: stores, connection checks, markets, demo store and automatic setup.',
  states: {
    'fresh-install': {
      pluginParameters: {},
      description:
        'No settings yet: one empty store, the "How to get one" docs link and Advanced settings closed.',
    },
    'advanced-settings': {
      pluginParameters: v3([demoConnection()]),
      description:
        'Advanced settings opened: Add another store, the demo store switch and auto-apply.',
    },
    'v2-migrated': {
      pluginParameters: {
        paramsVersion: '2',
        shopifyDomain: 'datocms-demo',
        storefrontAccessToken: DEMO_TOKEN,
        autoApplyToFieldsWithApiKey: '^shopify_',
        useDemoStore: false,
      },
      description:
        'v2 parameters (bare subdomain), normalized to v3 and checked live on mount (capabilities included); Save is enabled to write them.',
    },
    'no-capabilities': {
      pluginParameters: v3([demoConnection({ capabilities: undefined })]),
      description:
        'A saved store without capabilities (detection failed at boot, or Save anyway): the mount check detects them, and Save offers to keep them.',
    },
    'demo-store': {
      pluginParameters: v3([], { useDemoStore: true }),
      description:
        'Demo store on, no store of its own: the top notice points to Advanced settings.',
    },
    'demo-store-with-stores': {
      pluginParameters: v3([demoConnection()], { useDemoStore: true }),
      description:
        'Demo store on while a store is saved: the same top notice, the store kept as is.',
    },
    connected: {
      pluginParameters: v3([
        demoConnection({
          defaultCountry: 'US',
          capabilities: {
            tags: true,
            inventory: true,
            metafields: true,
            checkedAt: '2026-09-28T09:30:00.000Z',
          },
        }),
      ]),
      description:
        'A saved store with saved capabilities, verified live on mount.',
    },
    'more-options': {
      pluginParameters: v3([demoConnection({ defaultCountry: 'US' })]),
      description:
        'A connected store with More options open: the tokenless switch and the default market.',
    },
    'inventory-missing': {
      pluginParameters: v3([demoConnection()]),
      description:
        'Re-check runs live capability detection: the demo token has no inventory scope.',
    },
    'two-stores': {
      pluginParameters: v3([
        demoConnection({ label: 'Main store' }),
        {
          shopDomain: SECOND_DOMAIN,
          storefrontAccessToken: 'b8f1e2d3c4a5968778695a4b3c2d1e0f',
          tokenless: false,
          label: 'Europe',
          defaultCountry: 'GB',
          capabilities: {
            tags: false,
            inventory: false,
            metafields: false,
            checkedAt: '2026-09-30T16:05:00.000Z',
          },
        },
      ]),
      description: 'Two stores: headers, labels and the ⋮ menu.',
    },
    'store-menu': {
      pluginParameters: v3([
        demoConnection({ label: 'Main store' }),
        {
          shopDomain: SECOND_DOMAIN,
          storefrontAccessToken: 'b8f1e2d3c4a5968778695a4b3c2d1e0f',
          tokenless: false,
          label: 'Europe',
        },
      ]),
      description: 'The ⋮ menu of the second store, open.',
    },
    'store-menu-keyboard': {
      pluginParameters: v3([
        demoConnection({ label: 'Main store' }),
        {
          shopDomain: SECOND_DOMAIN,
          storefrontAccessToken: 'b8f1e2d3c4a5968778695a4b3c2d1e0f',
          tokenless: false,
          label: 'Europe',
        },
      ]),
      description:
        'The ⋮ menu opened, then Down: keyboard focus on Remove store.',
    },
    'invalid-domain': {
      pluginParameters: {},
      description: 'A custom domain typed into Shop domain.',
    },
    'admin-token': {
      pluginParameters: {},
      description: 'An Admin API token pasted into the token field.',
    },
    'missing-token': {
      pluginParameters: {},
      description:
        'A domain without a token, then Save: the token error and the form line.',
    },
    'tokenless-locked': {
      pluginParameters: {},
      description:
        'More options, then tokenless against the password-protected demo store, then Save: live store-locked error, More options held open.',
    },
    'network-error': {
      pluginParameters: v3([demoConnection()]),
      description: 'fetch fails: the mount check shows the network error.',
    },
    'wrong-token': {
      pluginParameters: v3([demoConnection()]),
      description:
        'Shopify answers 401 (a mistyped or foreign token): the settings copy says what to check, not "update it in the plugin settings".',
    },
    'three-stores-removed': {
      pluginParameters: v3([
        demoConnection({ label: 'Main store' }),
        {
          shopDomain: SECOND_DOMAIN,
          storefrontAccessToken: 'b8f1e2d3c4a5968778695a4b3c2d1e0f',
          tokenless: false,
          label: 'Europe',
        },
        {
          shopDomain: THIRD_DOMAIN,
          storefrontAccessToken: 'c9a2f3e4d5b6a7988796a5b4c3d2e1f0',
          tokenless: false,
          label: 'United States',
        },
      ]),
      description:
        'Three stores; store 2 is removed from its ⋮ menu (confirm accepted): focus moves to the previous store.',
    },
    saving: {
      pluginParameters: v3([demoConnection()]),
      description:
        'Advanced settings opened, a pattern typed, then Save while Shopify never answers.',
    },
    'api-version-outdated': {
      pluginParameters: v3([demoConnection()]),
      description: 'publicApiVersions reports 2026-10 as unsupported.',
    },
    'read-only': {
      pluginParameters: v3([demoConnection()]),
      canEditSchema: false,
      description: 'A role that cannot edit the schema.',
    },
  },
  render: (ctx, state) => {
    patchFetch(state.name);
    return (
      <Scripted script={state.name}>
        <ConfigScreen ctx={ctx()} />
      </Scripted>
    );
  },
});
