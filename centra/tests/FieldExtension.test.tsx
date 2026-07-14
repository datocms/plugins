import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FieldExtension from '../src/entrypoints/FieldExtension';
import { CentraClient } from '../src/lib/centraClient';

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Spinner: () => <span>Loading</span>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const connection = {
  endpoint: 'https://example.centra.test/store-dtc-api-no-session',
  token: 'test-token',
};

function createCtx(
  overrides: Partial<{
    disabled: boolean;
    value: unknown;
    parameters: Record<string, unknown>;
    openModalResult: unknown;
  }> = {},
) {
  const setFieldValue = vi.fn().mockResolvedValue(undefined);
  const openModal = vi
    .fn()
    .mockResolvedValue(overrides.openModalResult ?? null);
  const ctx = {
    parameters: overrides.parameters ?? {
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    },
    plugin: {
      attributes: {
        parameters: {
          paramsVersion: '2',
          ...connection,
        },
      },
    },
    environment: 'primary',
    field: { attributes: { field_type: 'json' } },
    fieldPath: 'centra_reference',
    formValues: { centra_reference: overrides.value ?? null },
    disabled: overrides.disabled ?? false,
    setFieldValue,
    openModal,
    openConfirm: vi.fn().mockResolvedValue('cancel'),
  } as unknown as RenderFieldExtensionCtx;

  return { ctx, openModal, setFieldValue };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('FieldExtension', () => {
  it('persists only stable versioned IDs returned by the picker', async () => {
    const { ctx, openModal, setFieldValue } = createCtx({
      openModalResult: { references: [{ displayItemId: 2752 }] },
    });

    render(<FieldExtension ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select product' }));

    await waitFor(() => expect(openModal).toHaveBeenCalledOnce());
    const modalOptions = openModal.mock.calls[0]?.[0];
    expect(() => JSON.stringify(modalOptions?.parameters)).not.toThrow();
    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith(
        'centra_reference',
        JSON.stringify(
          {
            version: 1,
            kind: 'primaryProduct',
            references: [{ displayItemId: 2752 }],
          },
          null,
          2,
        ),
      ),
    );
  });

  it('does not expose mutations for a disabled field', () => {
    const { ctx, openModal } = createCtx({ disabled: true });
    render(<FieldExtension ctx={ctx} />);

    expect(
      screen.getByRole('button', { name: 'Select product' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select product' }));
    expect(openModal).not.toHaveBeenCalled();
  });

  it('preserves an unsupported document without rewriting it', () => {
    const { ctx, setFieldValue } = createCtx({
      value: JSON.stringify({
        version: 2,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }],
      }),
    });
    render(<FieldExtension ctx={ctx} />);

    expect(screen.getByText(/Saved value preserved/)).toBeInTheDocument();
    expect(
      screen.getByText(/unsupported Centra reference version 2/),
    ).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('warns without changing a product whose primary variant drifted', async () => {
    vi.spyOn(CentraClient.prototype, 'hydrateReferences').mockResolvedValue([
      {
        status: 'resolved',
        reference: { displayItemId: 2752 },
        displayItem: {
          id: 2752,
          name: 'Dog Toy',
          isPrimaryVariant: false,
          media: [],
          items: [],
        },
        primaryDrift: true,
      },
    ]);
    const { ctx, setFieldValue } = createCtx({
      value: JSON.stringify({
        version: 1,
        kind: 'primaryProduct',
        references: [{ displayItemId: 2752 }],
      }),
    });

    render(<FieldExtension ctx={ctx} />);

    expect(
      await screen.findByText(/no longer the primary variant/),
    ).toBeInTheDocument();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('does not restart hydration for an equivalent SDK context object', async () => {
    const hydrate = vi
      .spyOn(CentraClient.prototype, 'hydrateReferences')
      .mockResolvedValue([
        {
          status: 'resolved',
          reference: { displayItemId: 2752 },
          displayItem: {
            id: 2752,
            name: 'Dog Toy',
            isPrimaryVariant: true,
            media: [],
            items: [],
          },
          primaryDrift: false,
        },
      ]);
    const value = JSON.stringify({
      version: 1,
      kind: 'primaryProduct',
      references: [{ displayItemId: 2752 }],
    });
    const { ctx } = createCtx({ value });
    const { rerender } = render(<FieldExtension ctx={ctx} />);

    await waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    const firstSignal = hydrate.mock.calls[0]?.[0].signal;
    const equivalentCtx = {
      ...ctx,
      parameters: cloneJson(ctx.parameters),
      plugin: {
        ...ctx.plugin,
        attributes: {
          ...ctx.plugin.attributes,
          parameters: cloneJson(ctx.plugin.attributes.parameters),
        },
      },
      formValues: cloneJson(ctx.formValues),
    } as RenderFieldExtensionCtx;

    rerender(<FieldExtension ctx={equivalentCtx} />);

    expect(hydrate).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(false);
  });
});
