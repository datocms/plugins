// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  PropsWithChildren,
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkProgress, BulkResult } from '../actions/bulkChangeCreator';
import SelectCreatorModal from './SelectCreatorModal';

const mocks = vi.hoisted(() => ({
  bulkChangeCreator: vi.fn(),
  usersList: vi.fn(),
  ssoUsersList: vi.fn(),
  siteFind: vi.fn(),
}));

vi.mock('../actions/bulkChangeCreator', () => ({
  bulkChangeCreator: mocks.bulkChangeCreator,
}));

vi.mock('../services/cmaClient', () => ({
  makeClient: () => ({
    users: { list: mocks.usersList },
    ssoUsers: { list: mocks.ssoUsersList },
    site: { find: mocks.siteFind },
  }),
}));

type TestOption = { label: string; value: string; userType: string };
type TestSelectProps = {
  label: string;
  value: TestOption | null;
  error?: string;
  onChange: (option: TestOption | null) => void;
  selectInputProps: {
    options: Array<{ label: string; options: TestOption[] }>;
    isDisabled: boolean;
  };
};

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: PropsWithChildren) => <>{children}</>,
  Form: (props: FormHTMLAttributes<HTMLFormElement>) => <form {...props} />,
  Button: ({
    children,
    type,
    disabled,
    onClick,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  SelectField: ({
    label,
    value,
    error,
    onChange,
    selectInputProps,
  }: TestSelectProps) => {
    const options = selectInputProps.options.flatMap((group) => group.options);
    return (
      <>
        <select
          aria-label={label}
          value={value ? `${value.userType}:${value.value}` : ''}
          disabled={selectInputProps.isDisabled}
          onChange={(event) =>
            onChange(
              options.find(
                (option) =>
                  `${option.userType}:${option.value}` === event.target.value,
              ) ?? null,
            )
          }
        >
          <option value="">Choose creator</option>
          {options.map((option) => (
            <option
              key={`${option.userType}:${option.value}`}
              value={`${option.userType}:${option.value}`}
            >
              {option.label}
            </option>
          ))}
        </select>
        {error && <p>{error}</p>}
      </>
    );
  },
}));

function context(parameters: Record<string, unknown> = {}) {
  return {
    parameters,
    environment: 'main',
    currentUserAccessToken: 'test-token',
    cmaBaseUrl: 'https://example.invalid',
    resolve: vi.fn(),
  } as unknown as RenderModalCtx;
}

async function chooseOwner() {
  // All creator responses are mocked. Flush React's async effects directly so
  // assertions do not depend on a wall-clock polling timeout under parallel CI.
  await act(async () => {});
  expect(screen.getByRole('combobox')).toHaveProperty('disabled', false);
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'account:owner' },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.usersList.mockResolvedValue([]);
  mocks.ssoUsersList.mockResolvedValue([]);
  mocks.siteFind.mockResolvedValue({ owner: { id: 'owner', type: 'account' } });
});

afterEach(cleanup);

describe('SelectCreatorModal', () => {
  it('preserves the small selection flow and performs no mutation before submission', async () => {
    const ctx = context({ itemCount: 2 });
    render(<SelectCreatorModal ctx={ctx} />);
    await chooseOwner();
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Large selections can take hours/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Change creator' }));
    expect(ctx.resolve).toHaveBeenCalledWith({
      userId: 'owner',
      userType: 'account',
    });
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
  });

  it('shows real settled counts, stops future scheduling and waits for current requests to settle', async () => {
    const itemIds = Array.from(
      { length: 500 },
      (_, index) => `record-${index}`,
    );
    const ctx = context({ itemIds });
    let finish: (result: BulkResult) => void = () => {
      throw new Error('Execution did not start');
    };
    mocks.bulkChangeCreator.mockImplementation(
      () =>
        new Promise<BulkResult>((resolve) => {
          finish = resolve;
        }),
    );
    render(<SelectCreatorModal ctx={ctx} />);
    await chooseOwner();
    fireEvent.click(screen.getByRole('button', { name: 'Change creator' }));

    const execution = mocks.bulkChangeCreator.mock.calls[0][0] as {
      signal: AbortSignal;
      onProgress: (progress: BulkProgress) => void;
    };
    act(() =>
      execution.onProgress({
        total: 500,
        succeeded: 20,
        failed: 1,
        processed: 21,
        active: 6,
        stopping: false,
      }),
    );
    expect(screen.getByRole('progressbar')).toHaveProperty('value', 21);
    expect(screen.getByText(/20 changed, 6 in progress/).textContent).toContain(
      '1 failed',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(execution.signal.aborted).toBe(true);
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stopping…' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      screen.getByText(/Waiting for requests already started/),
    ).toBeTruthy();

    const result: BulkResult = {
      total: 500,
      succeeded: 26,
      failed: 1,
      unprocessed: 473,
      failureSamples: [{ id: 'record-20', error: 'Denied' }],
      stopped: true,
    };
    await act(async () => finish(result));
    expect(ctx.resolve).toHaveBeenCalledWith({ bulkResult: result });
  });

  it('allows available creators but warns when one creator endpoint fails', async () => {
    mocks.ssoUsersList.mockRejectedValue({ response: { status: 403 } });
    const ctx = context({ itemCount: 2 });
    render(<SelectCreatorModal ctx={ctx} />);
    await chooseOwner();
    expect(screen.getByRole('status').textContent).toContain(
      'Some creators could not be loaded',
    );
    expect(screen.getByRole('status').textContent).toContain('HTTP 403');
    fireEvent.click(screen.getByRole('button', { name: 'Change creator' }));
    expect(ctx.resolve).toHaveBeenCalledWith({
      userId: 'owner',
      userType: 'account',
    });
  });

  it('reports an unexpected execution error honestly instead of enabling another submission', async () => {
    mocks.bulkChangeCreator.mockRejectedValue(new Error('Unexpected failure'));
    const ctx = context({ itemIds: Array(500).fill('record') });
    render(<SelectCreatorModal ctx={ctx} />);
    await chooseOwner();
    fireEvent.click(screen.getByRole('button', { name: 'Change creator' }));
    await waitFor(() =>
      expect(ctx.resolve).toHaveBeenCalledWith({
        executionError: expect.stringContaining(
          'final outcome could not be confirmed',
        ),
      }),
    );
    expect(mocks.bulkChangeCreator).toHaveBeenCalledTimes(1);
  });

  it('cancels a large selection before submission without changing records', async () => {
    const ctx = context({ itemIds: Array(500).fill('record') });
    render(<SelectCreatorModal ctx={ctx} />);
    await chooseOwner();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ctx.resolve).toHaveBeenCalledWith(null);
    expect(mocks.bulkChangeCreator).not.toHaveBeenCalled();
  });
});
