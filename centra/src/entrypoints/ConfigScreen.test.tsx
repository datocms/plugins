import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import type { FormEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
  FieldGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Form: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  }) => <form onSubmit={onSubmit}>{children}</form>,
  TextField: ({
    id,
    label,
    value,
    onChange,
    error,
    textInputProps,
  }: {
    id: string;
    label: ReactNode;
    value: string;
    onChange: (value: string, event: unknown) => void;
    error?: ReactNode;
    textInputProps?: { type?: string; disabled?: boolean };
  }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={textInputProps?.type ?? 'text'}
        disabled={textInputProps?.disabled}
        value={value}
        onChange={(event) => onChange(event.target.value, event)}
      />
      {error && <span>{error}</span>}
    </div>
  ),
  Button: ({
    children,
    type = 'button',
    disabled,
  }: {
    children: ReactNode;
    type?: 'button' | 'submit';
    disabled?: boolean;
  }) => (
    <button type={type} disabled={disabled}>
      {children}
    </button>
  ),
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
  const updatePluginParameters = vi.fn().mockResolvedValue(undefined);
  const notice = vi.fn();
  const alert = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    plugin: { attributes: { parameters } },
    currentRole: {
      meta: { final_permissions: { can_edit_schema: canEditSchema } },
    },
    updatePluginParameters,
    notice,
    alert,
  } as unknown as RenderConfigScreenCtx;

  return { ctx, updatePluginParameters, notice, alert };
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

    expect(screen.getByLabelText('Storefront API URL')).toHaveValue(
      VALID_PARAMETERS.endpoint,
    );
    expect(screen.getByLabelText('API token')).toHaveAttribute(
      'type',
      'password',
    );
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

    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }));

    await waitFor(() => expect(updatePluginParameters).toHaveBeenCalledOnce());
    expect(clientMocks.constructor).toHaveBeenCalledWith(VALID_PARAMETERS);
    expect(clientMocks.searchDisplayItems).toHaveBeenCalledWith({
      kind: 'primaryProduct',
      limit: 1,
    });
    expect(updatePluginParameters).toHaveBeenCalledWith(VALID_PARAMETERS);
    expect(notice).toHaveBeenCalledWith('Centra connected successfully.');
  });

  it('keeps invalid credentials unsaved and shows field-level guidance', async () => {
    const { ctx, updatePluginParameters } = createCtx({ parameters: {} });
    render(<ConfigScreen ctx={ctx} />);

    fireEvent.change(screen.getByLabelText('Storefront API URL'), {
      target: { value: 'http://shop.example.com/graphql' },
    });
    fireEvent.change(screen.getByLabelText('API token'), {
      target: { value: 'catalog-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }));

    expect(await screen.findByText(/Use an HTTPS endpoint/i)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }));

    await waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(alert).toHaveBeenCalledWith('Invalid token [redacted]');
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('renders read-only credentials without a save action', () => {
    const { ctx } = createCtx({ canEditSchema: false });
    render(<ConfigScreen ctx={ctx} />);

    expect(screen.getByText(/can view these settings/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Storefront API URL')).toBeDisabled();
    expect(screen.getByLabelText('API token')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and connect' })).toBeDisabled();
  });
});
