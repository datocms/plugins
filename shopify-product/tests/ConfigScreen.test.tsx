import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVANCED_TOGGLE_ID } from '../src/components/settings/AdvancedSettings';
import { DUPLICATE_STORE_ERROR } from '../src/components/settings/draft';
import ConfigScreen from '../src/entrypoints/ConfigScreen';
import {
  ADMIN_TOKEN_ERROR,
  CUSTOM_DOMAIN_ERROR,
  EMPTY_TOKEN_ERROR,
} from '../src/lib/parameters';
import { ShopifyClientError } from '../src/lib/shopifyClient';
import type {
  ConnectionTestResult,
  StoreCapabilities,
  StoreConnection,
} from '../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const client = vi.hoisted(() => ({
  connectionTest: vi.fn(),
  detectCapabilities: vi.fn(),
  apiVersionListeners: new Set<() => void>(),
}));

vi.mock('../src/lib/shopifyClient', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/lib/shopifyClient')>();
  return {
    ...actual,
    getShopifyClient: (store: StoreConnection) => ({
      connectionTest: (options?: unknown) =>
        client.connectionTest(store, options),
      detectCapabilities: (options?: unknown) =>
        client.detectCapabilities(store, options),
    }),
    onApiVersionWarning: (listener: () => void) => {
      client.apiVersionListeners.add(listener);
      return () => client.apiVersionListeners.delete(listener);
    },
  };
});

// datocms-react-ui measures with these (some at import time); jsdom has neither.
vi.hoisted(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    IntersectionObserver: ObserverStub,
    ResizeObserver: ObserverStub,
  });
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Reflect.deleteProperty(window, 'matchMedia');
  client.connectionTest.mockReset();
  client.detectCapabilities.mockReset();
  client.apiVersionListeners.clear();
  client.connectionTest.mockResolvedValue(connectionResult());
  client.detectCapabilities.mockResolvedValue(capabilities());
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function connectionResult(
  overrides: Partial<ConnectionTestResult> = {},
): ConnectionTestResult {
  return {
    shopName: 'DatoCMS Demo',
    primaryDomainUrl: 'https://datocms-demo.myshopify.com',
    localization: {
      country: { isoCode: 'IT' },
      language: { isoCode: 'EN' },
      availableCountries: [
        { isoCode: 'IT', name: 'Italy', currency: { isoCode: 'EUR' } },
        { isoCode: 'US', name: 'United States', currency: { isoCode: 'USD' } },
      ],
      availableLanguages: [
        { isoCode: 'EN', endonymName: 'English' },
        { isoCode: 'IT', endonymName: 'italiano' },
      ],
    },
    publicApiVersions: [{ handle: '2026-10', supported: true }],
    respondedApiVersion: '2026-10',
    apiVersionOutdated: false,
    ...overrides,
  };
}

function capabilities(
  overrides: Partial<StoreCapabilities> = {},
): StoreCapabilities {
  return {
    tags: true,
    inventory: true,
    metafields: true,
    checkedAt: '2026-10-03T10:00:00.000Z',
    ...overrides,
  };
}

const SAVED_STORE: StoreConnection = {
  shopDomain: 'acme.myshopify.com',
  storefrontAccessToken: 'public-token',
  tokenless: false,
  capabilities: capabilities({
    inventory: false,
    checkedAt: '2026-09-28T09:30:00.000Z',
  }),
};

function v3(
  stores: StoreConnection[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    paramsVersion: '3',
    stores,
    useDemoStore: false,
    autoApplyToFieldsWithApiKey: '',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Setup = {
  canEditSchema?: boolean;
  updatePluginParameters?: (params: Record<string, unknown>) => Promise<void>;
};

function createCtx(parameters: unknown, options: Setup = {}) {
  const updatePluginParameters = vi.fn(
    options.updatePluginParameters ?? (async () => undefined),
  );
  const notice = vi.fn(async () => undefined);
  const alert = vi.fn(async () => undefined);
  const openConfirm = vi.fn(async () => true as unknown);
  const ctx = {
    mode: 'renderConfigScreen',
    bodyPadding: [0, 0, 0, 0],
    theme: {},
    cssDesignTokens: {},
    colorScheme: 'light',
    ui: { locale: 'en-US' },
    plugin: { id: 'plugin', attributes: { parameters } },
    currentRole: {
      meta: {
        final_permissions: { can_edit_schema: options.canEditSchema ?? true },
      },
    },
    updatePluginParameters,
    notice,
    alert,
    openConfirm,
    navigateTo: vi.fn(),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    isAutoResizerActive: () => true,
    updateHeight: vi.fn(),
  } as unknown as RenderConfigScreenCtx;
  return { ctx, updatePluginParameters, notice, alert, openConfirm };
}

function setup(parameters: unknown, options: Setup = {}) {
  const user = userEvent.setup();
  const mocks = createCtx(parameters, options);
  const view = render(<ConfigScreen ctx={mocks.ctx} />);
  return { user, view, ...mocks };
}

/**
 * Like the SDK: `updatePluginParameters` stores the parameters, then the host
 * renders the screen again with a new ctx that carries them.
 */
function hostSetup(parameters: unknown, options: Setup = {}) {
  const user = userEvent.setup();
  let current: unknown = parameters;
  let rerender: ((ctx: RenderConfigScreenCtx) => void) | null = null;
  const write = options.updatePluginParameters ?? (async () => undefined);
  const withParameters = (ctx: RenderConfigScreenCtx) =>
    ({
      ...ctx,
      plugin: { ...ctx.plugin, attributes: { parameters: current } },
    }) as unknown as RenderConfigScreenCtx;
  const mocks = createCtx(parameters, {
    ...options,
    updatePluginParameters: async (params) => {
      await write(params);
      current = JSON.parse(JSON.stringify(params));
      rerender?.(withParameters(mocks.ctx));
    },
  });
  const view = render(<ConfigScreen ctx={mocks.ctx} />);
  rerender = (ctx) => view.rerender(<ConfigScreen ctx={ctx} />);
  return { user, view, ...mocks, saved: () => current };
}

/** A promise and its resolve, to hold a request open. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const domainInputs = () => screen.getAllByLabelText(/^Shop domain/);
const tokenInputs = () => screen.getAllByLabelText(/^Storefront access token/);
const saveButton = () =>
  screen.getByRole('button', { name: /Save settings|Please wait/ });
const advancedToggle = () =>
  document.getElementById(ADVANCED_TOGGLE_ID) as HTMLElement;
const autoApplyInput = () =>
  screen.getByLabelText('Auto-apply to fields whose API key matches');
const moreOptionsButtons = () =>
  screen.getAllByRole('button', { name: 'More options' });
const howToGetOne = () =>
  screen.queryByRole('link', { name: 'How to get one' });
const SETUP_DOCS =
  'https://github.com/datocms/plugins/tree/master/shopify-product#connect-your-shopify-store';

type User = ReturnType<typeof userEvent.setup>;

/** Opens "Advanced settings" (more stores, the demo store, auto-apply). */
async function openAdvanced(user: User) {
  if (advancedToggle().getAttribute('aria-expanded') !== 'true') {
    await user.click(advancedToggle());
  }
  expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
}

/** Opens the "More options" of a store block (tokenless, default market). */
async function openMoreOptions(user: User, index = 0) {
  const button = moreOptionsButtons()[index] as HTMLElement;
  if (button.getAttribute('aria-expanded') !== 'true') {
    await user.click(button);
  }
  expect(moreOptionsButtons()[index]).toHaveAttribute('aria-expanded', 'true');
}

const DEMO_STORE_NOTICE =
  'The demo store is on, so editors browse sample products. Switch it off in Advanced settings.';

/**
 * Buttons that can turn unavailable while focused (Save, the connection
 * actions) say so with aria-disabled and stay focusable: never `disabled`.
 */
function expectUnavailable(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toBeEnabled();
}

function expectAvailable(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).toBeEnabled();
}

/** Makes `prefers-reduced-motion: reduce` match (jsdom has no matchMedia). */
function preferReducedMotion() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}

/** The kit marks required fields with an asterisk in the label only. */
function markedRequired(input: HTMLElement): boolean {
  const label = document.querySelector(`label[for="${input.id}"]`);
  return label?.textContent?.includes('*') ?? false;
}

function savedParameters(
  mock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  const calls = mock.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigScreen: fresh install', () => {
  it('shows one empty store, a docs link for the token, and a disabled Save', () => {
    setup({});

    expect(domainInputs()).toHaveLength(1);
    expect(domainInputs()[0]).toHaveValue('');
    expect(tokenInputs()[0]).toHaveValue('');
    expect(
      screen.getByText('A Shopify admin URL works too'),
    ).toBeInTheDocument();
    expect(howToGetOne()).toHaveAttribute('href', SETUP_DOCS);
    expect(screen.queryByText(/Create storefront/)).not.toBeInTheDocument();
    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Not checked yet/)).not.toBeInTheDocument();
    expectUnavailable(saveButton());
    expect(client.connectionTest).not.toHaveBeenCalled();
  });

  it('shows the normalized domain as a hint once valid', async () => {
    const { user } = setup({});

    await user.type(domainInputs()[0], 'https://admin.shopify.com/store/acme/');

    expect(screen.getByText('acme.myshopify.com')).toBeInTheDocument();
    expect(screen.getByText(/Connects to/)).toBeInTheDocument();
  });

  it('saves and connects: tests the store, stores its capabilities, saves v3', async () => {
    const { user, updatePluginParameters, notice } = setup({});

    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(client.connectionTest).toHaveBeenCalledWith(
      expect.objectContaining({
        shopDomain: 'acme.myshopify.com',
        storefrontAccessToken: 'public-token',
        tokenless: false,
      }),
      expect.anything(),
    );
    expect(client.detectCapabilities).toHaveBeenCalledTimes(1);
    expect(savedParameters(updatePluginParameters)).toEqual({
      paramsVersion: '3',
      stores: [
        {
          shopDomain: 'acme.myshopify.com',
          storefrontAccessToken: 'public-token',
          tokenless: false,
          capabilities: capabilities(),
        },
      ],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    });
    expect(notice).toHaveBeenCalledWith('Settings successfully saved!');
    expect(screen.getByText('DatoCMS Demo')).toBeInTheDocument();
  });

  it('shows "Please wait" while the connection check runs', async () => {
    client.connectionTest.mockReturnValue(new Promise(() => undefined));
    const { user, updatePluginParameters } = setup({});

    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());

    expect(saveButton()).toHaveTextContent('Please wait');
    expectUnavailable(saveButton());
    expect(screen.getByText('Checking the connection…')).toBeInTheDocument();
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('reports a failed save with the settings alert', async () => {
    const { user, alert } = setup(
      {},
      {
        updatePluginParameters: async () => {
          throw new Error('nope');
        },
      },
    );

    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Couldn't save the settings!"),
    );
    expect(saveButton()).toHaveTextContent('Save settings');
  });
});

describe('ConfigScreen: validation', () => {
  it('rejects a custom domain after blur', async () => {
    const { user } = setup({});

    await user.type(domainInputs()[0], 'www.acme.com');
    expect(screen.queryByText(CUSTOM_DOMAIN_ERROR)).not.toBeInTheDocument();
    await user.tab();

    expect(screen.getByText(CUSTOM_DOMAIN_ERROR)).toBeInTheDocument();
    expect(domainInputs()[0]).toHaveAttribute('aria-invalid', 'true');
  });

  it('flags a pasted Admin API token right away, verbatim', async () => {
    const { user } = setup({});

    await user.click(tokenInputs()[0]);
    await user.paste('shpat_0123456789abcdef');

    expect(screen.getByText(ADMIN_TOKEN_ERROR)).toBeInTheDocument();
  });

  it('shows every error and a form line on a failed submit, without testing', async () => {
    const { user, updatePluginParameters } = setup({});

    await user.type(domainInputs()[0], 'acme');
    await user.click(saveButton());

    expect(screen.getByText(EMPTY_TOKEN_ERROR)).toBeInTheDocument();
    expect(
      screen.getByText('Fix the errors above before saving'),
    ).toBeInTheDocument();
    expect(client.connectionTest).not.toHaveBeenCalled();
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('rejects duplicate stores', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));
    await user.type(domainInputs()[1], 'ACME.myshopify.com');
    await user.type(tokenInputs()[1], 'other-token');
    await user.click(saveButton());

    expect(screen.getByText(DUPLICATE_STORE_ERROR)).toBeInTheDocument();
  });

  it('validates the automatic-setup regular expression', async () => {
    const { user } = setup({});
    await openAdvanced(user);
    const input = autoApplyInput();

    await user.type(input, 'shopify_(');
    await user.tab();

    expect(
      screen.getByText('Field must be a valid regular expression'),
    ).toBeInTheDocument();
  });
});

describe('ConfigScreen: saved settings', () => {
  it('migrates v2 settings: bare subdomain, checked on mount, Save enabled', async () => {
    const { user, updatePluginParameters } = setup({
      paramsVersion: '2',
      shopifyDomain: 'acme',
      storefrontAccessToken: 'public-token',
      autoApplyToFieldsWithApiKey: '^shopify_',
      useDemoStore: false,
    });

    expect(domainInputs()[0]).toHaveValue('acme.myshopify.com');
    await openAdvanced(user);
    expect(autoApplyInput()).toHaveValue('^shopify_');
    expectAvailable(saveButton());
    expect(await screen.findByText('DatoCMS Demo')).toBeInTheDocument();
    // Saved without capabilities: the mount check detects them.
    expect(client.detectCapabilities).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('list', { name: 'Capabilities' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/to detect tags/)).not.toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toMatchObject({
      paramsVersion: '3',
      stores: [
        { shopDomain: 'acme.myshopify.com', capabilities: capabilities() },
      ],
      autoApplyToFieldsWithApiKey: '^shopify_',
    });
  });

  it('shows saved capabilities with their date', async () => {
    setup(v3([SAVED_STORE]));

    expect(await screen.findByText('DatoCMS Demo')).toBeInTheDocument();
    expect(screen.getByText(/API 2026-10/)).toBeInTheDocument();
    expect(screen.getByText('Checked on 09/28/2026')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Capabilities' });
    expect(within(list).getByText(/Inventory/)).toHaveTextContent(
      'Inventory: not available',
    );
    expect(within(list).getByText(/Tags/)).toHaveTextContent('Tags: available');
    expectUnavailable(saveButton());
  });

  it('links "How to get one" to the setup steps in the README, in a new tab', () => {
    setup({});

    const link = howToGetOne() as HTMLElement;
    expect(link).toHaveAttribute('href', SETUP_DOCS);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.queryByRole('button', {
        name: 'How to get a Storefront access token',
      }),
    ).not.toBeInTheDocument();
  });
  it('scrolls without animation when the user prefers reduced motion', async () => {
    preferReducedMotion();
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');

    await user.click(saveButton());
    await waitFor(() => expect(tokenInputs()[0]).toHaveFocus());
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'center',
    });
  });

  it('re-checks capabilities and explains how to unlock inventory', async () => {
    client.detectCapabilities.mockResolvedValue(
      capabilities({ tags: false, inventory: false }),
    );
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    await user.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() =>
      expect(screen.queryByText(/Checked on/)).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        'Enable "Read product inventory" in Headless → Storefront API permissions to show stock. If it\'s already on, publish some products to this storefront.',
      ),
    ).toBeInTheDocument();
    // Tags changed from the saved settings, so there is something to save.
    expectAvailable(saveButton());
  });

  it('lists only the capabilities the plugin uses, never metafields', async () => {
    // Shopify answers the metafield probe alike with or without the scope.
    client.detectCapabilities.mockResolvedValue(
      capabilities({ inventory: false, metafields: false }),
    );
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    await user.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() =>
      expect(screen.queryByText(/Checked on/)).not.toBeInTheDocument(),
    );
    const list = screen.getByRole('list', { name: 'Capabilities' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/metafield/i)).not.toBeInTheDocument();
    // Only metafields changed: nothing worth saving.
    expectUnavailable(saveButton());
  });

  it('shows the network error from the mount check and recovers with Try again', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup(v3([SAVED_STORE]));

    expect(
      await screen.findByText(
        "Couldn't reach Shopify. Check your connection or ad-blocker.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save anyway' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('DatoCMS Demo')).toBeInTheDocument();
  });

  it('shows the API version notice from the connection test', async () => {
    client.connectionTest.mockResolvedValue(
      connectionResult({ apiVersionOutdated: true, respondedApiVersion: null }),
    );
    setup(v3([SAVED_STORE]));

    expect(
      await screen.findByText(
        'This plugin version targets an expired Shopify API version. Update the plugin to keep it working.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(expired\)/)).toBeInTheDocument();
  });

  it('shows the API version notice when the client warns', async () => {
    setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    act(() => {
      for (const listener of client.apiVersionListeners) listener();
    });

    expect(
      screen.getByText(/targets an expired Shopify API version/),
    ).toBeInTheDocument();
  });

  it('starts over from the new parameters after a save', async () => {
    const { user, view, ctx } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    await openAdvanced(user);
    await user.type(autoApplyInput(), '^shop');
    expectAvailable(saveButton());

    // The SDK hands a new ctx whose parameters are what was just saved.
    const next = {
      ...ctx,
      plugin: {
        ...ctx.plugin,
        attributes: {
          ...ctx.plugin.attributes,
          parameters: v3([SAVED_STORE], {
            autoApplyToFieldsWithApiKey: '^shop',
          }),
        },
      },
    } as unknown as RenderConfigScreenCtx;
    view.rerender(<ConfigScreen ctx={next} />);

    await waitFor(() => expectUnavailable(saveButton()));
    // The saved store was already verified: no second check.
    expect(client.connectionTest).toHaveBeenCalledTimes(1);
  });

  it('saves the default market picked from the localization', async () => {
    const { user, updatePluginParameters } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    await openMoreOptions(user);
    await user.click(screen.getByRole('combobox', { name: 'Default country' }));
    await user.click(await screen.findByText('United States (USD)'));
    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toMatchObject({
      stores: [{ shopDomain: 'acme.myshopify.com', defaultCountry: 'US' }],
    });
  });

  it('is read-only for roles that cannot edit the schema', async () => {
    setup(v3([SAVED_STORE]), { canEditSchema: false });

    expect(
      screen.getByText(
        "Your role can view these settings but can't change them",
      ),
    ).toBeInTheDocument();
    expect(domainInputs()[0]).toBeDisabled();
    expectUnavailable(saveButton());
    await screen.findByText('DatoCMS Demo');

    await openAdvanced(userEvent.setup());
    expect(
      screen.queryByRole('button', { name: /Add another store/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Use the demo store?' }),
    ).toBeDisabled();
    expect(autoApplyInput()).toBeDisabled();
  });
});

describe('ConfigScreen: tokenless and failures', () => {
  it('hides the token for tokenless stores and offers Save anyway when the store is locked', async () => {
    client.connectionTest.mockRejectedValue(
      new ShopifyClientError(
        'store-locked',
        'Online Store channel is locked.',
        {
          status: 400,
        },
      ),
    );
    const { user, updatePluginParameters } = setup({});

    await user.type(domainInputs()[0], 'datocms-demo');
    await openMoreOptions(user);
    await user.click(
      screen.getByRole('switch', { name: 'Connect without a token?' }),
    );
    expect(screen.queryByLabelText(/^Storefront access token/)).toBeNull();
    // The hidden token needs the switch's explanation: More options stays open.
    expect(moreOptionsButtons()[0]).toHaveAttribute('aria-expanded', 'true');
    expect(moreOptionsButtons()[0]).toBeDisabled();
    await user.click(saveButton());

    expect(
      await screen.findByText(
        'This store is password-protected, so the plugin needs a Storefront access token.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Couldn't connect to Shopify. Fix the connection above, or save anyway.",
      ),
    ).toBeInTheDocument();
    expect(updatePluginParameters).not.toHaveBeenCalled();
    expectAvailable(saveButton());

    await user.click(screen.getByRole('button', { name: 'Save anyway' }));

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toEqual({
      paramsVersion: '3',
      stores: [
        {
          shopDomain: 'datocms-demo.myshopify.com',
          storefrontAccessToken: '',
          tokenless: true,
        },
      ],
      useDemoStore: false,
      autoApplyToFieldsWithApiKey: '',
    });
  });
});

describe('ConfigScreen: demo store', () => {
  it('saves without testing a blank store, which needs nothing while it is on', async () => {
    const { user, updatePluginParameters } = setup({});
    expect(markedRequired(domainInputs()[0])).toBe(true);
    expect(screen.queryByText(DEMO_STORE_NOTICE)).not.toBeInTheDocument();

    await openAdvanced(user);
    await user.click(
      screen.getByRole('switch', { name: 'Use the demo store?' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(DEMO_STORE_NOTICE);
    expect(markedRequired(domainInputs()[0])).toBe(false);
    expect(markedRequired(tokenInputs()[0])).toBe(false);
    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toEqual({
      paramsVersion: '3',
      stores: [],
      useDemoStore: true,
      autoApplyToFieldsWithApiKey: '',
    });
    expect(client.connectionTest).not.toHaveBeenCalled();
  });
});

describe('ConfigScreen: demo store with stores', () => {
  it('says at the top that the demo store is on and where to switch it off', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await openAdvanced(user);
    await user.click(
      screen.getByRole('switch', { name: 'Use the demo store?' }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(DEMO_STORE_NOTICE);
    expect(screen.queryByText(/stores above/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', { name: 'Use the demo store?' }),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the notice for saved settings with Advanced settings closed', () => {
    setup(v3([SAVED_STORE], { useDemoStore: true }));

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent(DEMO_STORE_NOTICE);
  });
});

describe('ConfigScreen: two stores', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
  };

  it('labels each store and makes the second one the default', async () => {
    const { user, updatePluginParameters, openConfirm } = setup(
      v3([SAVED_STORE, SECOND]),
    );

    expect(screen.getByText('Store 1 · default')).toBeInTheDocument();
    expect(screen.getByText('Store 2')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Label')[1]).toHaveValue('Europe');
    await waitFor(() => expect(client.connectionTest).toHaveBeenCalledTimes(2));

    await user.click(
      screen.getByRole('button', { name: 'Actions for store 2' }),
    );
    await user.click(await screen.findByText('Make default'));

    expect(openConfirm).toHaveBeenCalledWith({
      title: 'Make this the default store?',
      content:
        'Fields without a store setting switch from "acme.myshopify.com" to "Europe". Products already saved in those fields can stop loading or match a different product. Are you sure you want to proceed?',
      choices: [
        {
          label: 'Yes, make it the default',
          value: true,
          intent: 'positive',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
    expect(domainInputs()[1]).toHaveValue('acme.myshopify.com');

    await user.click(saveButton());
    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    const saved = savedParameters(updatePluginParameters);
    expect(saved.stores).toMatchObject([
      { shopDomain: 'acme-eu.myshopify.com', label: 'Europe' },
      { shopDomain: 'acme.myshopify.com' },
    ]);
  });

  it('removes a store after a destructive confirm', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));

    await user.click(
      screen.getByRole('button', { name: 'Actions for store 2' }),
    );
    await user.click(await screen.findByText('Remove store'));

    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove this store?',
        choices: [expect.objectContaining({ intent: 'negative' })],
      }),
    );
    await waitFor(() => expect(domainInputs()).toHaveLength(1));
    expect(screen.queryByText('Store 1 · default')).not.toBeInTheDocument();
    expectAvailable(saveButton());
  });

  it('keeps the store when the confirm is cancelled', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    openConfirm.mockResolvedValue(false);

    await user.click(
      screen.getByRole('button', { name: 'Actions for store 2' }),
    );
    await user.click(await screen.findByText('Remove store'));

    await waitFor(() => expect(openConfirm).toHaveBeenCalled());
    expect(domainInputs()).toHaveLength(2);
  });
});

describe('ConfigScreen: saving edge cases', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
  };

  it('ignores a blank store block for the dirty state', async () => {
    const { user } = hostSetup(v3([], { useDemoStore: true }));

    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));

    expect(domainInputs()).toHaveLength(2);
    expectUnavailable(saveButton());
  });

  it('starts over after a save even when the host never re-renders', async () => {
    const { user, notice } = setup(v3([], { useDemoStore: true }));
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));
    await user.type(autoApplyInput(), '^shop');

    await user.click(saveButton());

    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith('Settings successfully saved!'),
    );
    expectUnavailable(saveButton());
    // The blank block wasn't saved, so it's gone.
    expect(domainInputs()).toHaveLength(1);
  });

  it('saves once when Save anyway is double-clicked', async () => {
    const write = deferred<void>();
    const { user, updatePluginParameters, notice } = hostSetup(
      {},
      { updatePluginParameters: () => write.promise },
    );
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    await user.click(saveButton());
    const saveAnyway = await screen.findByRole('button', {
      name: 'Save anyway',
    });

    await user.dblClick(saveAnyway);

    expectUnavailable(saveAnyway);
    expectUnavailable(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => write.resolve());
    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(updatePluginParameters).toHaveBeenCalledTimes(1);
  });

  it('keeps what was typed while the save was running', async () => {
    const { user, saved } = hostSetup(v3([SAVED_STORE, SECOND]));
    await waitFor(() =>
      expect(screen.getAllByText(/Connected to/)).toHaveLength(2),
    );
    const checks: Array<() => void> = [];
    client.connectionTest.mockImplementation(
      () =>
        new Promise((resolve) => {
          checks.push(() => resolve(connectionResult()));
        }),
    );
    await user.type(screen.getAllByLabelText('Label')[0], 'Main');
    await user.click(saveButton());

    // Inputs only lock after a second, so this lands mid-save.
    await user.clear(screen.getAllByLabelText('Label')[1]);
    await user.type(screen.getAllByLabelText('Label')[1], 'EU');
    await act(async () => {
      for (const resolve of checks) resolve();
    });

    await waitFor(() =>
      expect(saveButton()).toHaveTextContent('Save settings'),
    );
    expect(saved()).toMatchObject({
      stores: [{ label: 'Main' }, { label: 'Europe' }],
    });
    const labels = screen.getAllByLabelText('Label');
    expect(labels[0]).toHaveValue('Main');
    expect(labels[1]).toHaveValue('EU');
    expectAvailable(saveButton());
  });

  it('saves the automatic-setup pattern exactly as it was', async () => {
    const { user, updatePluginParameters } = setup(
      v3([SAVED_STORE], { autoApplyToFieldsWithApiKey: ' ^shopify_' }),
    );
    await screen.findByText('DatoCMS Demo');

    await openAdvanced(user);
    await user.click(
      screen.getByRole('switch', { name: 'Use the demo store?' }),
    );
    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toMatchObject({
      autoApplyToFieldsWithApiKey: ' ^shopify_',
    });
  });

  it("doesn't save capabilities that belong to a previous token", async () => {
    const { user, updatePluginParameters } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    await user.clear(tokenInputs()[0]);
    await user.type(tokenInputs()[0], 'new-token');
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    await user.click(saveButton());

    await user.click(
      await screen.findByRole('button', { name: 'Save anyway' }),
    );

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    const [store] = savedParameters(updatePluginParameters)
      .stores as StoreConnection[];
    expect(store).toMatchObject({ storefrontAccessToken: 'new-token' });
    expect(store?.capabilities).toBeUndefined();
  });
});

describe('ConfigScreen: errors and focus', () => {
  it('moves focus to the first invalid input after a failed submit', async () => {
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');

    await user.click(saveButton());

    await waitFor(() => expect(tokenInputs()[0]).toHaveFocus());
  });

  it('shows no errors on a store added after a failed save', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());
    await screen.findByText(/Couldn't connect to Shopify\./);

    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));

    expect(domainInputs()).toHaveLength(2);
    expect(
      screen.queryByText('Enter your shop domain'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TOKEN_ERROR)).not.toBeInTheDocument();
  });

  it('drops a Test connection result once the token changed', async () => {
    const pending = deferred<ConnectionTestResult>();
    client.connectionTest.mockReturnValueOnce(pending.promise);
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'token-a');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    await user.type(tokenInputs()[0], 'b');
    await act(async () => pending.resolve(connectionResult()));

    expect(screen.queryByText(/Connected to/)).not.toBeInTheDocument();
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument();
  });

  it('names the expired pinned version and the one that answered', async () => {
    client.connectionTest.mockResolvedValue(
      connectionResult({
        apiVersionOutdated: true,
        respondedApiVersion: '2027-01',
      }),
    );
    setup(v3([SAVED_STORE]));

    expect(
      await screen.findByText(
        /API 2026-10 \(expired; Shopify answered with 2027-01\)/,
      ),
    ).toBeInTheDocument();
  });

  it('lets read-only roles re-check the connection', async () => {
    const { user } = setup(v3([SAVED_STORE]), { canEditSchema: false });
    await screen.findByText('DatoCMS Demo');

    const recheck = screen.getByRole('button', { name: 'Re-check' });
    expect(recheck).toBeEnabled();
    await user.click(recheck);

    await waitFor(() => expect(client.detectCapabilities).toHaveBeenCalled());
    expectUnavailable(saveButton());
  });
});

describe('ConfigScreen: removing stores', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
  };

  async function removeStore(
    user: ReturnType<typeof userEvent.setup>,
    position: number,
  ) {
    await user.click(
      screen.getByRole('button', { name: `Actions for store ${position}` }),
    );
    await user.click(await screen.findByText('Remove store'));
  }

  it('removes a blank block without a confirm', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE]));
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));

    await removeStore(user, 2);

    expect(openConfirm).not.toHaveBeenCalled();
    expect(domainInputs()).toHaveLength(1);
  });

  it('says which store becomes the default when removing the default one', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));

    await removeStore(user, 1);

    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'Are you sure you want to remove this store? Fields set to use it stop loading products until you add it again. Fields without a store setting switch to "Europe", the new default store.',
      }),
    );
    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
  });

  it("doesn't mention fields for a store that was never saved", async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE]));
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));
    await user.type(domainInputs()[1], 'beta');

    await removeStore(user, 2);

    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "Are you sure you want to remove this store? It isn't saved yet, so what you entered here is discarded.",
      }),
    );
  });

  it('explains the default store on the first label only', () => {
    setup(v3([SAVED_STORE, SECOND]));

    const hint = "Fields that don't pick a store use this one";
    expect(screen.getAllByText(hint)).toHaveLength(1);
    const first = screen.getByRole('group', { name: 'Store 1 · default' });
    const second = screen.getByRole('group', { name: 'Store 2' });
    expect(within(first).getByText(hint)).toBeInTheDocument();
    expect(within(second).getByLabelText('Label')).toHaveValue('Europe');
    expect(within(second).queryByText(hint)).not.toBeInTheDocument();
  });
});

describe('ConfigScreen: store menu keyboard', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
  };

  it('focuses the first option, moves with arrows and closes on Esc', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));
    const trigger = screen.getByRole('button', { name: 'Actions for store 2' });

    trigger.focus();
    await user.keyboard('{Enter}');

    const makeDefault = await screen.findByRole('menuitem', {
      name: 'Make default',
    });
    await waitFor(() => expect(makeDefault).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitem', { name: 'Remove store' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(makeDefault).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('menuitem', { name: 'Make default' }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaves focus on the trigger when opened with the mouse, then Down enters', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));
    const trigger = screen.getByRole('button', { name: 'Actions for store 2' });

    await user.click(trigger);
    const makeDefault = await screen.findByRole('menuitem', {
      name: 'Make default',
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(makeDefault).not.toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(makeDefault).toHaveFocus();
  });

  it('runs the focused option with Enter', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));
    screen.getByRole('button', { name: 'Actions for store 2' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Make default' }),
      ).toHaveFocus(),
    );

    await user.keyboard('{Enter}');

    expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com');
  });
});

describe('ConfigScreen: making a store the default', () => {
  // Saved capabilities: the mount check leaves the form clean.
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
    capabilities: capabilities(),
  };

  async function makeDefault(
    user: ReturnType<typeof userEvent.setup>,
    position: number,
  ) {
    await user.click(
      screen.getByRole('button', { name: `Actions for store ${position}` }),
    );
    await user.click(await screen.findByText('Make default'));
  }

  it('keeps the order when the confirm is cancelled', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    openConfirm.mockResolvedValue(false);

    await makeDefault(user, 2);

    await waitFor(() => expect(openConfirm).toHaveBeenCalled());
    expect(domainInputs()[0]).toHaveValue('acme.myshopify.com');
    expectUnavailable(saveButton());
  });

  it('names the saved default as the form shows it now', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    await user.type(screen.getAllByLabelText('Label')[0], 'Main store');

    await makeDefault(user, 2);

    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'switch from "Main store" to "Europe".',
        ),
      }),
    );
  });

  it("doesn't ask when moving the saved default back to the top", async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    await makeDefault(user, 2);
    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
    openConfirm.mockClear();

    await makeDefault(user, 2);

    expect(domainInputs()[0]).toHaveValue('acme.myshopify.com');
    expect(openConfirm).not.toHaveBeenCalled();
    expectUnavailable(saveButton());
  });

  it("doesn't ask before any store is saved", async () => {
    const { user, openConfirm } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: /Add another store/ }));
    await user.type(domainInputs()[1], 'beta');

    await makeDefault(user, 2);

    expect(domainInputs()[0]).toHaveValue('beta');
    expect(openConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfigScreen: keeping keyboard focus', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
  };
  const THIRD: StoreConnection = {
    shopDomain: 'acme-us.myshopify.com',
    storefrontAccessToken: 'us-token',
    tokenless: false,
    label: 'United States',
  };

  async function removeWithKeyboard(
    user: ReturnType<typeof userEvent.setup>,
    position: number,
  ) {
    screen
      .getByRole('button', { name: `Actions for store ${position}` })
      .focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getAllByRole('menuitem')[0]).toHaveFocus(),
    );
    // Remove store is always last.
    await user.keyboard('{End}{Enter}');
  }

  it('keeps focus on Save while saving and once there is nothing left to save', async () => {
    const write = deferred<void>();
    const { user, notice } = setup(v3([SAVED_STORE]), {
      updatePluginParameters: () => write.promise,
    });
    await screen.findByText('DatoCMS Demo');
    await openAdvanced(user);
    await user.type(autoApplyInput(), '^shop');
    saveButton().focus();

    await user.keyboard('{Enter}');

    await waitFor(() => expect(saveButton()).toHaveTextContent('Please wait'));
    expect(saveButton()).toHaveFocus();
    expectUnavailable(saveButton());
    await act(async () => write.resolve());
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith('Settings successfully saved!'),
    );
    expect(saveButton()).toHaveTextContent('Save settings');
    expect(saveButton()).toHaveFocus();
    expectUnavailable(saveButton());
  });

  it("doesn't save from an unavailable Save or from Enter in a field", async () => {
    const { user, updatePluginParameters } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    await user.click(saveButton());
    await user.type(domainInputs()[0], '{Enter}');
    fireEvent.submit(saveButton().closest('form') as HTMLFormElement);

    expect(updatePluginParameters).not.toHaveBeenCalled();
    expect(client.detectCapabilities).not.toHaveBeenCalled();
    expect(screen.queryByText(EMPTY_TOKEN_ERROR)).not.toBeInTheDocument();
  });

  it('moves focus to the previous store after removing one', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND, THIRD]));

    await removeWithKeyboard(user, 2);

    await waitFor(() => expect(domainInputs()).toHaveLength(2));
    await waitFor(() => expect(domainInputs()[0]).toHaveFocus());
    expect(domainInputs()[0]).toHaveValue('acme.myshopify.com');
  });

  it('moves focus to the next store after removing the first one', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));

    await removeWithKeyboard(user, 1);

    await waitFor(() => expect(domainInputs()).toHaveLength(1));
    await waitFor(() => expect(domainInputs()[0]).toHaveFocus());
    expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com');
  });

  it('keeps focus on the trigger of the store made default', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));
    screen.getByRole('button', { name: 'Actions for store 2' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Make default' }),
      ).toHaveFocus(),
    );

    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Actions for store 1' }),
      ).toHaveFocus(),
    );
  });

  it('keeps focus on Re-check while it checks', async () => {
    const pending = deferred<StoreCapabilities>();
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    client.detectCapabilities.mockReturnValueOnce(pending.promise);
    const recheck = screen.getByRole('button', { name: 'Re-check' });
    recheck.focus();

    await user.keyboard('{Enter}');

    expect(screen.getByText('Checking the connection…')).toBeInTheDocument();
    expect(recheck).toHaveFocus();
    expectUnavailable(recheck);
    await act(async () => pending.resolve(capabilities()));
    expect(recheck).toHaveFocus();
    expectAvailable(recheck);
  });

  it('follows Try again to Re-check, and back when the check fails again', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup(v3([SAVED_STORE]));
    (await screen.findByRole('button', { name: 'Try again' })).focus();
    const pending = deferred<ConnectionTestResult>();
    client.connectionTest.mockReturnValueOnce(pending.promise);

    await user.keyboard('{Enter}');

    const recheck = screen.getByRole('button', { name: 'Re-check' });
    expect(recheck).toHaveFocus();
    expectUnavailable(recheck);
    await act(async () => pending.resolve(connectionResult()));
    expect(screen.getByRole('button', { name: 'Re-check' })).toHaveFocus();

    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus(),
    );
  });

  it('moves focus to Try again once Save anyway has saved', async () => {
    client.connectionTest.mockRejectedValue(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user, updatePluginParameters } = hostSetup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());
    const saveAnyway = await screen.findByRole('button', {
      name: 'Save anyway',
    });
    saveAnyway.focus();

    await user.keyboard('{Enter}');

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Save anyway' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  });
});

describe('ConfigScreen: connection copy', () => {
  it('says what to check when Shopify rejects the token', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('unauthorized', 'HTTP 401', { status: 401 }),
    );
    setup(v3([SAVED_STORE]));

    expect(
      await screen.findByText(
        'Shopify rejected this token. Check that it\'s the "Public access token" of a Headless storefront in this store.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/plugin settings/)).not.toBeInTheDocument();
  });

  it('detects the capabilities of a store saved without them', async () => {
    const { capabilities: _saved, ...withoutCapabilities } = SAVED_STORE;
    client.detectCapabilities.mockResolvedValue(
      capabilities({ inventory: false }),
    );
    const { user, updatePluginParameters } = setup(v3([withoutCapabilities]));

    const list = await screen.findByRole('list', { name: 'Capabilities' });
    expect(within(list).getByText(/Inventory/)).toHaveTextContent(
      'Inventory: not available',
    );
    expect(client.connectionTest).toHaveBeenCalledTimes(1);
    expectAvailable(saveButton());

    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toMatchObject({
      stores: [{ capabilities: capabilities({ inventory: false }) }],
    });
  });

  it('says what a tokenless store is missing', async () => {
    client.detectCapabilities.mockResolvedValue(
      capabilities({ tags: false, inventory: false, metafields: false }),
    );
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await openMoreOptions(user);
    await user.click(
      screen.getByRole('switch', { name: 'Connect without a token?' }),
    );

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText(
        'Tags and inventory need a Storefront access token',
      ),
    ).toBeInTheDocument();
  });
});

describe('ConfigScreen: automatic setup', () => {
  it('rejects patterns with nested repeats', async () => {
    const { user, updatePluginParameters } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    await openAdvanced(user);
    const input = autoApplyInput();

    await user.click(input);
    await user.paste('(\\w+_?)+product$');
    await user.click(saveButton());

    expect(input).toHaveValue('(\\w+_?)+product$');
    expect(
      screen.getByText(
        'Field cannot contain nested repeats like (a+)+, which can freeze record forms',
      ),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });
});

describe('ConfigScreen: collapsed sections', () => {
  it('keeps Advanced settings closed until opened', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: /Add another store/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Use the demo store?' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Auto-apply to fields whose API key matches'),
    ).not.toBeInTheDocument();

    await openAdvanced(user);

    expect(
      screen.getByRole('button', { name: /Add another store/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Each field can then pick which store it uses'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Use the demo store?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Browse sample products without a Shopify account'),
    ).toBeInTheDocument();
    expect(autoApplyInput()).toHaveValue('');

    await user.click(advancedToggle());

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: /Add another store/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps Advanced settings open while the auto-apply pattern has an error', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    await openAdvanced(user);
    await user.type(autoApplyInput(), 'shopify_(');
    await user.tab();
    expect(
      screen.getByText('Field must be a valid regular expression'),
    ).toBeInTheDocument();

    await user.click(advancedToggle());

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(autoApplyInput()).toHaveValue('shopify_(');

    // Fixed, it stays open until closed.
    await user.type(autoApplyInput(), ')');
    expect(
      screen.queryByText('Field must be a valid regular expression'),
    ).not.toBeInTheDocument();
    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(advancedToggle());
    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens Advanced settings on Save to show an invalid saved pattern', async () => {
    const { user, updatePluginParameters } = setup(
      v3([SAVED_STORE], { autoApplyToFieldsWithApiKey: '(\\w+_?)+product$' }),
    );
    await screen.findByText('DatoCMS Demo');
    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    await openMoreOptions(user);
    await user.click(screen.getByRole('combobox', { name: 'Default country' }));
    await user.click(await screen.findByText('United States (USD)'));

    await user.click(saveButton());

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Field cannot contain nested repeats like (a+)+, which can freeze record forms',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(autoApplyInput()).toHaveFocus());
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('keeps the fixed field on screen once the auto-apply error is gone', async () => {
    const { user } = setup(
      v3([SAVED_STORE], { autoApplyToFieldsWithApiKey: '(\\w+_?)+product$' }),
    );
    await screen.findByText('DatoCMS Demo');
    await openMoreOptions(user);
    await user.click(screen.getByRole('combobox', { name: 'Default country' }));
    await user.click(await screen.findByText('United States (USD)'));
    await user.click(saveButton());
    await waitFor(() => expect(autoApplyInput()).toHaveFocus());

    await user.clear(autoApplyInput());
    await user.type(autoApplyInput(), '^shopify_');

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(autoApplyInput()).toHaveValue('^shopify_');
    expect(autoApplyInput()).toHaveFocus();
  });

  it('starts each store with More options closed', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    const [button] = moreOptionsButtons();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toBeEnabled();
    expect(
      screen.queryByRole('switch', { name: 'Connect without a token?' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Default country' }),
    ).not.toBeInTheDocument();

    await openMoreOptions(user);

    expect(
      screen.getByRole('switch', { name: 'Connect without a token?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Public stores only, without tags or inventory'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Default country' }),
    ).toBeInTheDocument();

    await user.click(moreOptionsButtons()[0] as HTMLElement);

    expect(moreOptionsButtons()[0]).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('switch', { name: 'Connect without a token?' }),
    ).not.toBeInTheDocument();
  });

  it('keeps More options open for a tokenless store', () => {
    setup(
      v3([
        {
          shopDomain: 'acme.myshopify.com',
          storefrontAccessToken: '',
          tokenless: true,
        },
      ]),
    );

    const [button] = moreOptionsButtons();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'Connect without a token?' }),
    ).toBeChecked();
    expect(screen.queryByLabelText(/^Storefront access token/)).toBeNull();
  });

  it('keeps "How to get one" next to the token hint, also once connected', async () => {
    const { user } = setup({});
    expect(howToGetOne()).toBeInTheDocument();
    await user.type(tokenInputs()[0], 'public-token');
    expect(howToGetOne()).toBeInTheDocument();
    expect(
      screen.getByText(/From your Headless storefront in Shopify/),
    ).toBeInTheDocument();
  });
  it('shows "How to get one" for a saved store with a token', async () => {
    setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    expect(howToGetOne()).toHaveAttribute('href', SETUP_DOCS);
  });
});
