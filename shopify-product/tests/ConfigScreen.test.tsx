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

// tests/setup.ts stubs matchMedia; one test makes it match.
const defaultMatchMedia = window.matchMedia;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = defaultMatchMedia;
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
    // English dates in a fixed time zone: "checked on" reads 09/28/2026.
    ui: { locale: 'en', timezone: 'UTC' },
    site: { attributes: { internal_domain: null } },
    plugin: { id: 'plugin', attributes: { parameters } },
    currentRole: {
      meta: {
        final_permissions: { can_edit_schema: options.canEditSchema ?? true },
      },
    },
    updatePluginParameters,
    notice,
    alert,
    customToast: vi.fn(async () => undefined),
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
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const advancedToggle = () =>
  screen.getByRole('button', { name: 'Advanced settings' });
const autoApplyInput = () =>
  screen.getByLabelText('Auto-apply to fields whose API key matches');
const tokenlessSwitch = () =>
  screen.getByRole('checkbox', { name: 'Connect without a token' });
const demoStoreSwitch = () =>
  screen.getByRole('checkbox', { name: 'Use the demo store' });
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

/** The settings row (Connection, Tag filters, Stock levels) with this title. */
function settingsRow(title: string): HTMLElement {
  return screen.getByText(title).closest('li') as HTMLElement;
}

/** The group of a store, by the title its heading shows. */
function storeGroup(title: string): HTMLElement {
  return screen
    .getByRole('heading', { name: title })
    .closest('.Page__group') as HTMLElement;
}

const DEMO_STORE_NOTICE =
  'The demo store is on: editors browse sample products until you switch it off in Advanced settings.';

/**
 * A default market choice: radios, since the fixtures' stores sell in a few
 * countries and languages (a longer list is a select).
 */
function marketGroup(name: string): HTMLElement {
  return screen.getByRole('radiogroup', { name });
}

/** The demo store notice, by its text. */
function demoStoreNote(): HTMLElement {
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent('The demo store is on');
  return note;
}

/** Disabled with a reason: it says so with aria-disabled and keeps focus. */
function expectUnavailable(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toBeEnabled();
}

function expectAvailable(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).not.toHaveAttribute('aria-busy');
  expect(button).toBeEnabled();
}

/** Busy: a spinner, and no second click until the work ends. */
function expectBusy(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toBeDisabled();
}

/** Makes `prefers-reduced-motion: reduce` match. */
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

/** The "⋮" of the store at a 1-based position (named after the store). */
function storeMenu(position: number): HTMLElement {
  return screen.getAllByRole('button', { name: /^Actions for / })[
    position - 1
  ] as HTMLElement;
}

/** Opens the "⋮" of a store and picks an option with the mouse. */
async function pickStoreAction(user: User, position: number, option: string) {
  await user.click(storeMenu(position));
  await user.click(await screen.findByRole('menuitem', { name: option }));
}

const KEY_CODES = { Enter: 13, Escape: 27, ArrowDown: 40 } as const;

/**
 * The kit's menus read the key code (`which`), which user-event leaves at 0
 * in jsdom: this presses a key on the focused element like a browser does.
 */
function press(key: keyof typeof KEY_CODES) {
  const code = KEY_CODES[key];
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key,
    code: key,
    keyCode: code,
    which: code,
  });
}

/** Opens the "⋮" of a store from the keyboard; the menu takes focus. */
async function openStoreMenuWithKeyboard(position: number) {
  storeMenu(position).focus();
  press('Enter');
  await waitFor(() => expect(screen.getByRole('menu')).toHaveFocus());
}

/** Moves the menu's highlight down to an option. */
function highlight(option: string) {
  const menu = screen.getByRole('menu');
  const target = screen.getByRole('menuitem', { name: option });
  for (let step = 0; step < 4; step += 1) {
    if (menu.getAttribute('aria-activedescendant') === target.id) break;
    press('ArrowDown');
  }
  expect(menu).toHaveAttribute('aria-activedescendant', target.id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigScreen: fresh install', () => {
  it('shows one empty store, a docs link for the token, and an unavailable Save', () => {
    setup({});

    expect(
      screen.getByRole('heading', { name: 'Shopify store' }),
    ).toBeInTheDocument();
    expect(domainInputs()).toHaveLength(1);
    expect(domainInputs()[0]).toHaveValue('');
    expect(tokenInputs()[0]).toHaveValue('');
    expect(
      screen.getByText('A Shopify admin URL works too.'),
    ).toBeInTheDocument();
    expect(howToGetOne()).toHaveAttribute('href', SETUP_DOCS);
    expect(screen.queryByText(/Create storefront/)).not.toBeInTheDocument();
    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Not checked yet')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Actions for / }),
    ).not.toBeInTheDocument();
    expectUnavailable(saveButton());
    expect(client.connectionTest).not.toHaveBeenCalled();
  });

  it('shows the normalized domain as a hint once valid', async () => {
    const { user } = setup({});

    await user.type(domainInputs()[0], 'https://admin.shopify.com/store/acme/');

    expect(screen.getByText('acme.myshopify.com')).toBeInTheDocument();
    expect(screen.getByText(/Connects to/)).toBeInTheDocument();
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Test connection' }),
    ).toBeInTheDocument();
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
    expect(notice).toHaveBeenCalledWith('Settings saved.');
    expect(screen.getByText('DatoCMS Demo')).toBeInTheDocument();
  });

  it('shows Save as busy while the connection check runs', async () => {
    client.connectionTest.mockReturnValue(new Promise(() => undefined));
    const { user, updatePluginParameters } = setup({});

    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());

    expectBusy(saveButton());
    expect(screen.getByText('Checking the connection…')).toBeInTheDocument();
    // One spinner: Save's. Re-check waits, disabled.
    expect(
      screen.getByRole('button', { name: /Re-check|Test connection/ }),
    ).not.toHaveAttribute('aria-busy');
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
      expect(alert).toHaveBeenCalledWith("Couldn't save the settings."),
    );
    // Still dirty: Save is ready to try again.
    await waitFor(() => expectAvailable(saveButton()));
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

  it('shows every error on a failed submit, under its field, without testing', async () => {
    const { user, updatePluginParameters } = setup({});

    await user.type(domainInputs()[0], 'acme');
    await user.click(saveButton());

    expect(screen.getByText(EMPTY_TOKEN_ERROR)).toBeInTheDocument();
    // No second message for the same errors above Save.
    expect(screen.queryByText(/before saving/)).toBeNull();
    expect(client.connectionTest).not.toHaveBeenCalled();
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('rejects duplicate stores', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: 'Add another store' }));
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
      screen.getByText('Enter a valid regular expression'),
    ).toBeInTheDocument();
  });
});

describe('ConfigScreen: saved settings', () => {
  it('migrates v2 settings: bare subdomain, checked on mount, Save available', async () => {
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
    // Both abilities are there: their rows don't show.
    await waitFor(() =>
      expect(client.detectCapabilities).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText('Tag filters')).not.toBeInTheDocument();
    expect(screen.queryByText('Stock levels')).not.toBeInTheDocument();
    expect(screen.queryByText(/Re-check to detect/)).not.toBeInTheDocument();

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
    const connection = settingsRow('Connection');
    expect(connection).toHaveTextContent('Connected');
    // The API version shows only once it expired, in its own group.
    expect(connection).toHaveTextContent(
      'DatoCMS Demo, checked on 09/28/2026.',
    );
    expect(connection).not.toHaveTextContent('API');
    expect(
      within(settingsRow('Stock levels')).getByText('Not available'),
    ).toBeInTheDocument();
    // What's available needs nothing: no row.
    expect(screen.queryByText('Tag filters')).not.toBeInTheDocument();
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
      expect(screen.queryByText(/checked on/i)).not.toBeInTheDocument(),
    );
    expect(
      within(settingsRow('Stock levels')).getByText(
        'Enable "Read product inventory" in Headless → Storefront API permissions, or publish some products to this storefront.',
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
      expect(screen.queryByText(/checked on/i)).not.toBeInTheDocument(),
    );
    // Connection, then the one missing ability (tags are there: no row).
    const rows = within(settingsRow('Connection').parentElement as HTMLElement);
    expect(rows.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/metafield/i)).not.toBeInTheDocument();
    // Only metafields changed: nothing worth saving.
    expectUnavailable(saveButton());
  });

  it('shows the network error from the mount check and recovers with Re-check', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup(v3([SAVED_STORE]));

    // The cause is announced: focus stays where it was.
    expect(
      await screen.findByText(
        "Couldn't reach Shopify: check your internet connection or ad blocker.",
      ),
    ).toHaveAttribute('role', 'alert');
    expect(settingsRow('Connection')).toHaveTextContent('Not connected');
    expect(
      screen.queryByRole('button', { name: 'Save anyway' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Re-check' }));

    expect(await screen.findByText('DatoCMS Demo')).toBeInTheDocument();
    expect(
      screen.queryByText(/Couldn't reach Shopify/),
    ).not.toBeInTheDocument();
  });

  it('shows the API version problem from the connection test', async () => {
    client.connectionTest.mockResolvedValue(
      connectionResult({ apiVersionOutdated: true, respondedApiVersion: null }),
    );
    setup(v3([SAVED_STORE]));

    expect(
      await screen.findByText(
        'Shopify no longer supports the version this plugin uses. Update the plugin from the plugins list to keep it working.',
      ),
    ).toBeInTheDocument();
    const problem = screen
      .getByRole('heading', { name: 'Shopify API version' })
      .closest('.Page__group') as HTMLElement;
    expect(within(problem).getByText('Expired')).toBeInTheDocument();
    // Said once: the Connection row doesn't repeat it.
    expect(settingsRow('Connection')).not.toHaveTextContent('expired');
  });

  it('shows the API version problem when the client warns', async () => {
    setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    expect(
      screen.queryByRole('heading', { name: 'Shopify API version' }),
    ).not.toBeInTheDocument();

    act(() => {
      for (const listener of client.apiVersionListeners) listener();
    });

    expect(
      screen.getByText(/no longer supports the version this plugin uses/),
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

    await user.click(
      within(marketGroup('Default country')).getByRole('radio', {
        name: 'United States (USD)',
      }),
    );
    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toMatchObject({
      stores: [{ shopDomain: 'acme.myshopify.com', defaultCountry: 'US' }],
    });
  });

  it('keeps a saved country that Shopify no longer offers', async () => {
    setup(v3([{ ...SAVED_STORE, defaultCountry: 'DE' }]));
    await screen.findByText('DatoCMS Demo');

    const country = within(marketGroup('Default country'));
    expect(
      country.getByRole('radio', { name: 'Germany (not available)' }),
    ).toBeChecked();
    expect(
      country.getByRole('radio', { name: 'Shopify default' }),
    ).toBeInTheDocument();
  });

  it('is read-only for roles that cannot edit the schema', async () => {
    setup(v3([SAVED_STORE]), { canEditSchema: false });

    expect(
      screen.getByText(
        "Your role can view these settings but can't change them.",
      ),
    ).toBeInTheDocument();
    // Text stays readable and copyable: read-only, not disabled.
    expect(domainInputs()[0]).toHaveAttribute('readonly');
    expect(domainInputs()[0]).toBeEnabled();
    expect(screen.getByLabelText(/^Storefront access token/)).toHaveAttribute(
      'readonly',
    );
    // Nothing to save for this role: no Save at all.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await screen.findByText('DatoCMS Demo');

    await openAdvanced(userEvent.setup());
    expect(
      screen.queryByRole('button', { name: 'Add another store' }),
    ).not.toBeInTheDocument();
    expect(demoStoreSwitch()).toBeDisabled();
    expect(autoApplyInput()).toHaveAttribute('readonly');
    expect(autoApplyInput()).toBeEnabled();
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
    await user.click(tokenlessSwitch());
    expect(screen.queryByLabelText(/^Storefront access token/)).toBeNull();
    await user.click(saveButton());

    expect(
      await screen.findByText(
        'This store is password-protected: switch off "Connect without a token" and paste a Storefront access token.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The settings weren't saved: fix the connection above, or save anyway.",
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
    await user.click(demoStoreSwitch());
    expect(demoStoreNote()).toHaveTextContent(DEMO_STORE_NOTICE);
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
    expect(screen.queryByText(DEMO_STORE_NOTICE)).not.toBeInTheDocument();

    await openAdvanced(user);
    await user.click(demoStoreSwitch());

    expect(demoStoreNote()).toHaveTextContent(DEMO_STORE_NOTICE);
    expect(screen.queryByText(/stores above/)).not.toBeInTheDocument();

    await user.click(demoStoreSwitch());
    expect(screen.queryByText(DEMO_STORE_NOTICE)).not.toBeInTheDocument();
  });

  it('shows the notice for saved settings with Advanced settings closed', () => {
    setup(v3([SAVED_STORE], { useDemoStore: true }));

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(demoStoreNote()).toHaveTextContent(DEMO_STORE_NOTICE);
  });
});

describe('ConfigScreen: two stores', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
  };

  it('names each store and makes the second one the default', async () => {
    const { user, updatePluginParameters, openConfirm } = setup(
      v3([SAVED_STORE, SECOND]),
    );

    expect(
      within(storeGroup('acme.myshopify.com')).getByText('Default'),
    ).toBeInTheDocument();
    expect(
      within(storeGroup('Europe')).queryByText('Default'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Label')[1]).toHaveValue('Europe');
    await waitFor(() => expect(client.connectionTest).toHaveBeenCalledTimes(2));

    await pickStoreAction(user, 2, 'Make default');

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
    expect(within(storeGroup('Europe')).getByText('Default')).toBeVisible();

    await user.click(saveButton());
    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    const saved = savedParameters(updatePluginParameters);
    expect(saved.stores).toMatchObject([
      { shopDomain: 'acme-eu.myshopify.com', label: 'Europe' },
      { shopDomain: 'acme.myshopify.com' },
    ]);
  });

  it('offers only Remove store on the default store', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));

    await user.click(
      screen.getByRole('button', { name: 'Actions for acme.myshopify.com' }),
    );

    const options = await screen.findAllByRole('menuitem');
    expect(options.map((option) => option.textContent)).toEqual([
      'Remove store',
    ]);
  });

  it('removes a store after a destructive confirm', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));

    await pickStoreAction(user, 2, 'Remove store');

    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove this store?',
        choices: [expect.objectContaining({ intent: 'negative' })],
      }),
    );
    await waitFor(() => expect(domainInputs()).toHaveLength(1));
    expect(
      screen.getByRole('heading', { name: 'Shopify store' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
    expectAvailable(saveButton());
  });

  it('keeps the store when the confirm is cancelled', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    openConfirm.mockResolvedValue(false);

    await pickStoreAction(user, 2, 'Remove store');

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
    await user.click(screen.getByRole('button', { name: 'Add another store' }));

    expect(domainInputs()).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Store 2' })).toBeVisible();
    expectUnavailable(saveButton());
  });

  it('starts over after a save even when the host never re-renders', async () => {
    const { user, notice } = setup(v3([], { useDemoStore: true }));
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: 'Add another store' }));
    await user.type(autoApplyInput(), '^shop');

    await user.click(saveButton());

    await waitFor(() => expect(notice).toHaveBeenCalledWith('Settings saved.'));
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

    expectBusy(saveAnyway);
    expectUnavailable(saveButton());
    expectUnavailable(screen.getByRole('button', { name: 'Re-check' }));
    await act(async () => write.resolve());
    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(updatePluginParameters).toHaveBeenCalledTimes(1);
  });

  it('keeps what was typed while the save was running', async () => {
    const { user, saved } = hostSetup(v3([SAVED_STORE, SECOND]));
    await waitFor(() =>
      expect(screen.getAllByText('Connected')).toHaveLength(2),
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

    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
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
    await user.click(demoStoreSwitch());
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

  it('moves focus to the failed connection after a failed save', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');

    await user.click(saveButton());

    const failed = (await screen.findByText(/Couldn't reach Shopify/)).closest(
      '[data-connection-failed="true"]',
    ) as HTMLElement;
    await waitFor(() => expect(failed).toHaveFocus());
    expect(within(failed).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows no errors on a store added after a failed save', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await user.click(saveButton());
    await screen.findByText(
      "The settings weren't saved: fix the connection above, or save anyway.",
    );

    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: 'Add another store' }));

    expect(domainInputs()).toHaveLength(2);
    await waitFor(() => expect(domainInputs()[1]).toHaveFocus());
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

    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  });

  it('says an expired version once, in its own group', async () => {
    client.connectionTest.mockResolvedValue(
      connectionResult({
        apiVersionOutdated: true,
        respondedApiVersion: '2027-01',
      }),
    );
    setup(v3([SAVED_STORE]));

    expect(
      await screen.findByText(
        /no longer supports the version this plugin uses/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2026-10/)).not.toBeInTheDocument();
  });

  it('lets read-only roles re-check the connection', async () => {
    const { user } = setup(v3([SAVED_STORE]), { canEditSchema: false });
    await screen.findByText('DatoCMS Demo');

    const recheck = screen.getByRole('button', { name: 'Re-check' });
    expectAvailable(recheck);
    await user.click(recheck);

    await waitFor(() => expect(client.detectCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('ConfigScreen: removing stores', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
    label: 'Europe',
  };

  it('removes a blank block without a confirm', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE]));
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: 'Add another store' }));

    await pickStoreAction(user, 2, 'Remove store');

    expect(openConfirm).not.toHaveBeenCalled();
    expect(domainInputs()).toHaveLength(1);
  });

  it('says which store becomes the default when removing the default one', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));

    await pickStoreAction(user, 1, 'Remove store');

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
    await user.click(screen.getByRole('button', { name: 'Add another store' }));
    await user.type(domainInputs()[1], 'beta');

    await pickStoreAction(user, 2, 'Remove store');

    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "Are you sure you want to remove this store? It isn't saved yet, so what you entered here is discarded.",
      }),
    );
  });

  it('marks the default store with its pill, not with a label hint', () => {
    setup(v3([SAVED_STORE, SECOND]));

    const first = storeGroup('acme.myshopify.com');
    const second = storeGroup('Europe');
    expect(within(first).getByText('Default')).toBeInTheDocument();
    expect(within(second).queryByText('Default')).not.toBeInTheDocument();
    expect(within(second).getByLabelText('Label')).toHaveValue('Europe');
    expect(
      screen.queryByText("Fields that don't pick a store use this one."),
    ).not.toBeInTheDocument();
  });
});

describe('ConfigScreen: store menu keyboard', () => {
  const SECOND: StoreConnection = {
    shopDomain: 'acme-eu.myshopify.com',
    storefrontAccessToken: 'eu-token',
    tokenless: false,
  };

  it('opens from the keyboard, moves with the arrows and closes on Escape', async () => {
    setup(v3([SAVED_STORE, SECOND]));
    const trigger = screen.getByRole('button', {
      name: 'Actions for acme-eu.myshopify.com',
    });

    await openStoreMenuWithKeyboard(2);
    const menu = screen.getByRole('menu');
    const makeDefault = screen.getByRole('menuitem', { name: 'Make default' });
    const remove = screen.getByRole('menuitem', { name: 'Remove store' });

    // A menu that a key opens has its first option highlighted.
    expect(menu).toHaveAttribute('aria-activedescendant', makeDefault.id);
    press('ArrowDown');
    expect(menu).toHaveAttribute('aria-activedescendant', remove.id);
    press('ArrowDown');
    expect(menu).toHaveAttribute('aria-activedescendant', makeDefault.id);

    press('Escape');

    await waitFor(() =>
      expect(
        screen.queryByRole('menuitem', { name: 'Make default' }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens with the mouse, then the arrows move through the options', async () => {
    const { user } = setup(v3([SAVED_STORE, SECOND]));
    const trigger = screen.getByRole('button', {
      name: 'Actions for acme-eu.myshopify.com',
    });

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu).toHaveFocus());
    expect(menu).not.toHaveAttribute('aria-activedescendant');

    press('ArrowDown');
    expect(menu).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('menuitem', { name: 'Make default' }).id,
    );
  });

  it('runs the highlighted option with Enter', async () => {
    setup(v3([SAVED_STORE, SECOND]));
    await openStoreMenuWithKeyboard(2);
    highlight('Make default');

    press('Enter');

    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
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

  it('keeps the order when the confirm is cancelled', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    openConfirm.mockResolvedValue(false);

    await pickStoreAction(user, 2, 'Make default');

    await waitFor(() => expect(openConfirm).toHaveBeenCalled());
    expect(domainInputs()[0]).toHaveValue('acme.myshopify.com');
    expectUnavailable(saveButton());
  });

  it('names the saved default as the form shows it now', async () => {
    const { user, openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    await user.type(screen.getAllByLabelText('Label')[0], 'Main store');

    await pickStoreAction(user, 2, 'Make default');

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
    await pickStoreAction(user, 2, 'Make default');
    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
    openConfirm.mockClear();

    await pickStoreAction(user, 2, 'Make default');

    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme.myshopify.com'),
    );
    expect(openConfirm).not.toHaveBeenCalled();
    expectUnavailable(saveButton());
  });

  it("doesn't ask before any store is saved", async () => {
    const { user, openConfirm } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'public-token');
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: 'Add another store' }));
    await user.type(domainInputs()[1], 'beta');

    await pickStoreAction(user, 2, 'Make default');

    await waitFor(() => expect(domainInputs()[0]).toHaveValue('beta'));
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

  async function removeWithKeyboard(position: number) {
    await openStoreMenuWithKeyboard(position);
    highlight('Remove store');
    press('Enter');
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

    await waitFor(() => expectBusy(saveButton()));
    // A browser drops the focus of a disabled button: jsdom doesn't.
    act(() => saveButton().blur());
    await act(async () => write.resolve());
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Settings saved.'));
    expect(saveButton()).not.toHaveAttribute('aria-busy');
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
    setup(v3([SAVED_STORE, SECOND, THIRD]));

    await removeWithKeyboard(2);

    await waitFor(() => expect(domainInputs()).toHaveLength(2));
    await waitFor(() => expect(domainInputs()[0]).toHaveFocus());
    expect(domainInputs()[0]).toHaveValue('acme.myshopify.com');
  });

  it('moves focus to the next store after removing the first one', async () => {
    setup(v3([SAVED_STORE, SECOND]));

    await removeWithKeyboard(1);

    await waitFor(() => expect(domainInputs()).toHaveLength(1));
    await waitFor(() => expect(domainInputs()[0]).toHaveFocus());
    expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com');
  });

  it('gives focus back to the trigger after a cancelled remove', async () => {
    const { openConfirm } = setup(v3([SAVED_STORE, SECOND]));
    openConfirm.mockResolvedValue(false);

    await removeWithKeyboard(2);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Actions for Europe' }),
      ).toHaveFocus(),
    );
    expect(domainInputs()).toHaveLength(2);
  });

  it('keeps focus on the trigger of the store made default', async () => {
    setup(v3([SAVED_STORE, SECOND]));
    await openStoreMenuWithKeyboard(2);
    highlight('Make default');

    press('Enter');

    await waitFor(() =>
      expect(domainInputs()[0]).toHaveValue('acme-eu.myshopify.com'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Actions for Europe' }),
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
    expectBusy(recheck);
    // A browser drops the focus of a disabled button: jsdom doesn't.
    act(() => recheck.blur());
    await act(async () => pending.resolve(capabilities()));
    expect(recheck).toHaveFocus();
    expectAvailable(recheck);
  });

  it('keeps focus on Re-check through a failed check and a new one', async () => {
    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText(/Couldn't reach Shopify/);
    const recheck = screen.getByRole('button', { name: 'Re-check' });
    recheck.focus();
    const pending = deferred<ConnectionTestResult>();
    client.connectionTest.mockReturnValueOnce(pending.promise);

    await user.keyboard('{Enter}');

    expectBusy(recheck);
    await act(async () => pending.resolve(connectionResult()));
    expect(recheck).toHaveFocus();
    expect(screen.getByText('DatoCMS Demo')).toBeInTheDocument();

    client.connectionTest.mockRejectedValueOnce(
      new ShopifyClientError('network', 'Failed to fetch'),
    );
    await user.keyboard('{Enter}');

    await screen.findByText(/Couldn't reach Shopify/);
    expect(recheck).toHaveFocus();
    expectAvailable(recheck);
  });

  it('moves focus to Save once Save anyway has saved', async () => {
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
    expect(saveButton()).toHaveFocus();
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
        'Shopify rejected this token: use the Public access token of a Headless storefront in this store.',
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

    await screen.findByText('Stock levels');
    expect(
      within(settingsRow('Stock levels')).getByText('Not available'),
    ).toBeInTheDocument();
    expect(client.connectionTest).toHaveBeenCalledTimes(1);
    expectAvailable(saveButton());

    await user.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalled());
    expect(savedParameters(updatePluginParameters)).toMatchObject({
      stores: [{ capabilities: capabilities({ inventory: false }) }],
    });
  });

  it('asks to re-check when the store answered but its capabilities are unknown', async () => {
    const pending = deferred<ConnectionTestResult>();
    client.connectionTest.mockReturnValueOnce(pending.promise);
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.type(tokenInputs()[0], 'token-a');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    // The answer lands for another token, so the draft doesn't take it.
    await user.type(tokenInputs()[0], 'b');
    await act(async () => pending.resolve(connectionResult()));

    await user.type(tokenInputs()[0], '{Backspace}');

    expect(settingsRow('Connection')).toHaveTextContent(
      'DatoCMS Demo. Re-check to detect stock levels and tag filters.',
    );
    expect(screen.queryByText('Tag filters')).not.toBeInTheDocument();
  });

  it('says what a tokenless store is missing', async () => {
    client.detectCapabilities.mockResolvedValue(
      capabilities({ tags: false, inventory: false, metafields: false }),
    );
    const { user } = setup({});
    await user.type(domainInputs()[0], 'acme');
    await user.click(tokenlessSwitch());

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText('Tag filters need a Storefront access token.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Stock levels need a Storefront access token.'),
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
        'Remove nested repeats like (a+)+: they can freeze record forms',
      ),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });
});

describe('ConfigScreen: collapsed groups', () => {
  it('keeps Advanced settings closed until opened', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: 'Add another store' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Use the demo store' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Auto-apply to fields whose API key matches'),
    ).not.toBeInTheDocument();

    await openAdvanced(user);

    expect(
      screen.getByRole('button', { name: 'Add another store' }),
    ).toHaveAccessibleDescription(
      'Each field can then pick which store it uses.',
    );
    expect(demoStoreSwitch()).toBeInTheDocument();
    expect(
      screen.getByText('Browse sample products without a Shopify account.'),
    ).toBeInTheDocument();
    expect(autoApplyInput()).toHaveValue('');

    await user.click(advancedToggle());

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: 'Add another store' }),
    ).not.toBeInTheDocument();
  });

  it('keeps Advanced settings open while the auto-apply pattern has an error', async () => {
    const { user } = setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    await openAdvanced(user);
    await user.type(autoApplyInput(), 'shopify_(');
    await user.tab();
    expect(
      screen.getByText('Enter a valid regular expression'),
    ).toBeInTheDocument();

    // It can't close while the error shows.
    expect(advancedToggle()).toBeDisabled();
    await user.click(advancedToggle());

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(autoApplyInput()).toHaveValue('shopify_(');

    // Fixed, it stays open until closed.
    await user.type(autoApplyInput(), ')');
    expect(
      screen.queryByText('Enter a valid regular expression'),
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
    await user.click(
      within(marketGroup('Default country')).getByRole('radio', {
        name: 'United States (USD)',
      }),
    );

    await user.click(saveButton());

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Remove nested repeats like (a+)+: they can freeze record forms',
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
    await user.click(
      within(marketGroup('Default country')).getByRole('radio', {
        name: 'United States (USD)',
      }),
    );
    await user.click(saveButton());
    await waitFor(() => expect(autoApplyInput()).toHaveFocus());

    await user.clear(autoApplyInput());
    await user.type(autoApplyInput(), '^shopify_');

    expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(autoApplyInput()).toHaveValue('^shopify_');
    expect(autoApplyInput()).toHaveFocus();
  });

  it('shows the token switch and the default market in the store itself', async () => {
    setup(v3([SAVED_STORE]));

    expect(
      screen.queryByRole('button', { name: 'More options' }),
    ).not.toBeInTheDocument();
    expect(tokenlessSwitch()).not.toBeChecked();
    expect(
      screen.getByText(
        'Public stores only, without tag filters or stock levels.',
      ),
    ).toBeInTheDocument();
    // The market comes from the connection: it shows once connected.
    expect(
      screen.queryByRole('radiogroup', { name: 'Default country' }),
    ).not.toBeInTheDocument();

    await screen.findByText('DatoCMS Demo');

    expect(marketGroup('Default country')).toBeInTheDocument();
    expect(marketGroup('Default language')).toBeInTheDocument();
  });

  it('hides the token of a saved tokenless store', () => {
    setup(
      v3([
        {
          shopDomain: 'acme.myshopify.com',
          storefrontAccessToken: '',
          tokenless: true,
        },
      ]),
    );

    expect(tokenlessSwitch()).toBeChecked();
    expect(screen.queryByLabelText(/^Storefront access token/)).toBeNull();
  });

  it('keeps "How to get one" next to the token hint, also once connected', async () => {
    const { user } = setup({});
    expect(howToGetOne()).toBeInTheDocument();
    await user.type(tokenInputs()[0], 'public-token');
    expect(howToGetOne()).toBeInTheDocument();
    expect(
      screen.getByText('From your Headless storefront in Shopify.'),
    ).toBeInTheDocument();
  });

  it('shows "How to get one" for a saved store with a token', async () => {
    setup(v3([SAVED_STORE]));
    await screen.findByText('DatoCMS Demo');
    expect(howToGetOne()).toHaveAttribute('href', SETUP_DOCS);
  });
});
