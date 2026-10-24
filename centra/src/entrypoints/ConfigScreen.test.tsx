import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasCtx } from '../../tests/canvasCtx';
import type { CentraPluginParametersV2 } from '../types';
import ConfigScreen from './ConfigScreen';

afterEach(cleanup);

const clientMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  searchDisplayItems: vi.fn(),
}));

vi.mock('../lib/centraClient', () => ({
  CentraClient: class {
    constructor(connection: unknown) {
      clientMocks.constructor(connection);
    }

    searchDisplayItems(options: unknown) {
      return clientMocks.searchDisplayItems(options);
    }
  },
}));

const VALID_PARAMETERS: CentraPluginParametersV2 = {
  paramsVersion: '2',
  endpoint: 'https://shop.example.com/store-api-no-session',
  token: 'catalog-token',
};

function createCtx({
  parameters = VALID_PARAMETERS,
  canEditSchema = true,
}: {
  parameters?: Record<string, unknown> | CentraPluginParametersV2;
  canEditSchema?: boolean;
} = {}) {
  const base = canvasCtx();
  const updatePluginParameters = vi.fn(async () => undefined);
  const ctx = {
    ...base,
    mode: 'renderConfigScreen',
    plugin: { id: 'plugin-id', attributes: { parameters } },
    currentRole: {
      meta: { final_permissions: { can_edit_schema: canEditSchema } },
    },
    updatePluginParameters,
  } as unknown as RenderConfigScreenCtx;

  return {
    ctx,
    updatePluginParameters,
    notice: base.notice,
    alert: base.alert,
  };
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save' });
}

describe('ConfigScreen', () => {
  beforeEach(() => {
    clientMocks.constructor.mockReset();
    clientMocks.searchDisplayItems.mockReset();
    clientMocks.searchDisplayItems.mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
    });
  });

  it('shows only the required connection settings', () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);

    expect(screen.getByLabelText(/Storefront API URL/)).toHaveValue(
      VALID_PARAMETERS.endpoint,
    );
    expect(screen.getByLabelText(/API token/)).toHaveAttribute(
      'type',
      'password',
    );
    expect(saveButton()).toBeInTheDocument();
    expect(screen.queryByText('Market')).not.toBeInTheDocument();
    expect(screen.queryByText('Pricelist')).not.toBeInTheDocument();
    expect(screen.queryByText('Language overrides')).not.toBeInTheDocument();
    expect(screen.queryByText(/environment override/i)).not.toBeInTheDocument();
  });

  it('migrates existing settings, verifies the connection, and saves v2', async () => {
    const { ctx, updatePluginParameters, notice } = createCtx({
      parameters: {
        paramsVersion: '1',
        defaultConnection: {
          endpoint: VALID_PARAMETERS.endpoint,
          token: VALID_PARAMETERS.token,
          marketId: 4,
          pricelistId: 19,
          defaultLanguageCode: 'en-GB',
          languageByDatoLocale: { de: 'de-DE' },
        },
        connectionsByEnvironment: {},
      },
    });
    render(<ConfigScreen ctx={ctx} />);

    fireEvent.click(saveButton());

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalledOnce());
    expect(clientMocks.constructor).toHaveBeenCalledWith(VALID_PARAMETERS);
    expect(clientMocks.searchDisplayItems).toHaveBeenCalledWith({
      kind: 'primaryProduct',
      limit: 1,
    });
    expect(updatePluginParameters).toHaveBeenCalledWith(VALID_PARAMETERS);
    expect(notice).toHaveBeenCalledWith(
      'Centra connected. Add the Centra editor to a JSON field to use it.',
    );
  });

  it('keeps invalid credentials unsaved and shows field-level guidance', async () => {
    const { ctx, updatePluginParameters } = createCtx({ parameters: {} });
    render(<ConfigScreen ctx={ctx} />);

    const endpoint = screen.getByLabelText(/Storefront API URL/);
    fireEvent.change(endpoint, {
      target: { value: 'http://shop.example.com/graphql' },
    });
    fireEvent.change(screen.getByLabelText(/API token/), {
      target: { value: 'catalog-token' },
    });
    fireEvent.click(saveButton());

    expect(
      await screen.findByText(/Use an HTTPS endpoint/i),
    ).toBeInTheDocument();
    // The error is the field's: the input gets the invalid state
    expect(endpoint).toHaveAttribute('aria-invalid', 'true');

    // A value that isn't a URL gets the field's error too, not the browser's
    fireEvent.change(endpoint, { target: { value: 'shop.example.com' } });
    fireEvent.click(saveButton());

    expect(
      await screen.findByText('Enter a valid absolute URL.'),
    ).toBeInTheDocument();
    expect(updatePluginParameters).not.toHaveBeenCalled();
    expect(clientMocks.searchDisplayItems).not.toHaveBeenCalled();
  });

  it('does not save when Centra rejects the connection', async () => {
    clientMocks.searchDisplayItems.mockRejectedValue(
      new Error(`Invalid token ${VALID_PARAMETERS.token}`),
    );
    const { ctx, updatePluginParameters, alert } = createCtx({
      parameters: { ...VALID_PARAMETERS, paramsVersion: '1' },
    });
    render(<ConfigScreen ctx={ctx} />);

    fireEvent.click(saveButton());

    await waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(alert).toHaveBeenCalledWith('Invalid token [redacted]');
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('leaves the saving state while the failure alert is still open', async () => {
    clientMocks.searchDisplayItems.mockRejectedValue(
      new Error('Centra is unavailable'),
    );
    const { ctx, alert } = createCtx({
      parameters: { ...VALID_PARAMETERS, paramsVersion: '1' },
    });
    alert.mockReturnValue(new Promise(() => undefined));
    render(<ConfigScreen ctx={ctx} />);

    fireEvent.click(saveButton());

    await waitFor(() => expect(alert).toHaveBeenCalledOnce());
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
  });

  it('saves only changes, and Enter in a field submits them', async () => {
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    const token = screen.getByLabelText(/API token/);
    const form = token.closest('form');
    if (!form) throw new Error('The settings are not in a form');

    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.submit(form);
    expect(clientMocks.searchDisplayItems).not.toHaveBeenCalled();

    fireEvent.change(token, { target: { value: ' another-token ' } });

    expect(saveButton()).not.toHaveAttribute('aria-disabled');
    fireEvent.submit(form);

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalledOnce());
    expect(updatePluginParameters).toHaveBeenCalledWith({
      ...VALID_PARAMETERS,
      token: 'another-token',
    });
  });

  it('renders read-only credentials without a save action', () => {
    const { ctx } = createCtx({ canEditSchema: false });
    render(<ConfigScreen ctx={ctx} />);

    expect(
      screen.getByText("Your role can't change the plugin settings."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Storefront API URL/)).toBeDisabled();
    expect(screen.getByLabelText(/API token/)).toBeDisabled();
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(saveButton());

    expect(clientMocks.searchDisplayItems).not.toHaveBeenCalled();
  });
});
