// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderUploadSidebarPanelCtx } from 'datocms-plugin-sdk';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssetEnvironmentOperations,
  type Environment,
} from '../utils/assetEnvironmentOperations';
import { AssetDeletionSidebar } from './AssetDeletionSidebar';

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Spinner: () => <span data-testid="loading-spinner" />,
}));

vi.mock('../utils/assetEnvironmentOperations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../utils/assetEnvironmentOperations')
  >()),
  createAssetEnvironmentOperations: vi.fn(),
}));

type Operations = ReturnType<typeof createAssetEnvironmentOperations>;
type LookupResult = Awaited<ReturnType<Operations['checkEnvironments']>>;
type DeleteResult = Awaited<ReturnType<Operations['deleteCopies']>>;

function environment(id: string): Environment {
  return {
    id,
    type: 'environment',
    meta: {
      status: 'ready',
      read_only_mode: false,
      created_at: '2026-01-01T00:00:00.000Z',
      last_data_change_at: '2026-01-01T00:00:00.000Z',
      primary: false,
      forked_from: null,
    },
  };
}

function context({
  uploadId = 'upload-00009999',
  environment: currentEnvironment = 'current-environment',
  apiToken = 'synthetic-token',
  environmentsAccess = 'all',
  finalEnvironmentsAccess = environmentsAccess,
}: {
  uploadId?: string;
  environment?: string;
  apiToken?: string | null;
  environmentsAccess?: string | null;
  finalEnvironmentsAccess?: string | null;
} = {}) {
  const openConfirm = vi
    .fn<RenderUploadSidebarPanelCtx['openConfirm']>()
    .mockResolvedValue('deleteAll');
  const notice = vi
    .fn<RenderUploadSidebarPanelCtx['notice']>()
    .mockResolvedValue(undefined);
  const ctx = {
    currentUserAccessToken: apiToken,
    currentRole: {
      attributes: { environments_access: environmentsAccess },
      meta: {
        final_permissions: { environments_access: finalEnvironmentsAccess },
      },
    },
    environment: currentEnvironment,
    cmaBaseUrl: 'https://cma.example.test/api/',
    upload: { id: uploadId },
    site: {
      id: 'synthetic-site',
      attributes: { internal_domain: 'synthetic.admin.datocms.com' },
    },
    openConfirm,
    notice,
  } as unknown as RenderUploadSidebarPanelCtx;
  return { ctx, openConfirm, notice };
}

function operations(matches: Environment[] = []) {
  return {
    listEnvironments: vi
      .fn<Operations['listEnvironments']>()
      .mockResolvedValue(matches),
    checkEnvironments: vi
      .fn<Operations['checkEnvironments']>()
      .mockResolvedValue({ matches, failures: [] }),
    deleteCopies: vi
      .fn<Operations['deleteCopies']>()
      .mockResolvedValue({ deletedEnvIds: [], absentEnvIds: [], failures: [] }),
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Promise not initialized');
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function deleteButton() {
  return screen.getByRole('button', { name: /^Delete this asset from/ });
}

const createOperations = vi.mocked(createAssetEnvironmentOperations);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

describe('environment discovery feedback', () => {
  it('finishes loading when there are no other environments and identifies the last copy', async () => {
    const service = operations();
    service.listEnvironments.mockResolvedValue([
      environment('current-environment'),
    ]);
    createOperations.mockReturnValue(service);
    const { ctx, openConfirm } = context();
    render(<AssetDeletionSidebar ctx={ctx} />);

    expect(screen.getByTestId('loading-spinner')).toBeTruthy();
    expect(
      await screen.findByText(/This is the last remaining copy/),
    ).toBeTruthy();
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
    expect(service.checkEnvironments).toHaveBeenCalledWith(
      [environment('current-environment')],
      ctx.upload.id,
      ctx.environment,
      expect.any(Function),
    );
    expect(
      screen.queryByRole('button', { name: /^Delete this asset from/ }),
    ).toBeNull();
    expect(openConfirm).not.toHaveBeenCalled();
  });

  it.each(['list', 'lookup'] as const)(
    'does not claim the last copy after a %s failure',
    async (stage) => {
      const service = operations();
      if (stage === 'list')
        service.listEnvironments.mockRejectedValue(
          new Error('Synthetic listing failure'),
        );
      else
        service.checkEnvironments.mockRejectedValue(
          new Error('Synthetic lookup failure'),
        );
      createOperations.mockReturnValue(service);
      render(<AssetDeletionSidebar ctx={context().ctx} />);

      expect(
        await screen.findByText(/Could not check every environment/),
      ).toBeTruthy();
      expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
      expect(screen.queryByTestId('loading-spinner')).toBeNull();
      expect(screen.getByRole('button', { name: 'Retry check' })).toBeTruthy();
      if (stage === 'list')
        expect(service.checkEnvironments).not.toHaveBeenCalled();
    },
  );

  it('does not claim the last copy when an individual environment could not be checked', async () => {
    const service = operations();
    service.checkEnvironments.mockResolvedValue({
      matches: [],
      failures: [
        {
          envId: 'inaccessible',
          message: 'INSUFFICIENT_PERMISSIONS (HTTP 403)',
        },
      ],
    });
    createOperations.mockReturnValue(service);
    render(<AssetDeletionSidebar ctx={context().ctx} />);

    expect(
      await screen.findByText(/inaccessible: INSUFFICIENT_PERMISSIONS/),
    ).toBeTruthy();
    expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
  });

  it('shows only the first five lookup errors initially and exposes every remaining error on demand', async () => {
    const service = operations();
    service.checkEnvironments.mockResolvedValue({
      matches: [],
      failures: Array.from({ length: 12 }, (_, index) => ({
        envId: `failed-${index}`,
        message: 'HTTP 403',
      })),
    });
    createOperations.mockReturnValue(service);
    render(<AssetDeletionSidebar ctx={context().ctx} />);
    await screen.findByText('failed-0: HTTP 403');

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByText('failed-11: HTTP 403')).toBeNull();
    const summary = screen.getByText('Show 7 more environment errors');
    const details = summary.closest('details');
    if (!details) throw new Error('Expected expandable error details');
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });

    expect(await screen.findByText('failed-11: HTTP 403')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
  });

  it('automatically shows exact completed progress for many environments', async () => {
    const pending = deferred<LookupResult>();
    const service = operations();
    service.checkEnvironments.mockImplementation(
      async (_environments, _uploadId, _currentEnv, onProgress) => {
        onProgress?.({ completed: 3, total: 1_200 });
        return pending.promise;
      },
    );
    createOperations.mockReturnValue(service);
    render(<AssetDeletionSidebar ctx={context().ctx} />);

    expect(
      await screen.findByText('Checking 3 of 1200 environments...'),
    ).toBeTruthy();
    await act(async () => pending.resolve({ matches: [], failures: [] }));
    expect(screen.getByText(/This is the last remaining copy/)).toBeTruthy();
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
  });

  it('rechecks after failure, replaces stale errors, and completes the new loading state', async () => {
    const oldService = operations();
    oldService.checkEnvironments.mockResolvedValue({
      matches: [],
      failures: [{ envId: 'inaccessible', message: 'HTTP 403' }],
    });
    const newService = operations([environment('now-accessible')]);
    createOperations
      .mockReturnValueOnce(oldService)
      .mockReturnValueOnce(newService);
    render(<AssetDeletionSidebar ctx={context().ctx} />);
    await screen.findByText('inaccessible: HTTP 403');
    const oldSignal = createOperations.mock.calls[0][0].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Retry check' }));

    expect(
      await screen.findByRole('link', { name: 'now-accessible' }),
    ).toBeTruthy();
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByText('inaccessible: HTTP 403')).toBeNull();
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
    expect(oldService.checkEnvironments).toHaveBeenCalledTimes(1);
    expect(newService.checkEnvironments).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'missing token', apiToken: null, environmentsAccess: 'all' },
    {
      label: 'restricted environment permission',
      apiToken: 'synthetic-token',
      environmentsAccess: 'primary_only',
    },
  ])(
    'does not create an API service with $label',
    ({ apiToken, environmentsAccess }) => {
      const { ctx } = context({ apiToken, environmentsAccess });
      render(<AssetDeletionSidebar ctx={ctx} />);

      expect(
        screen.getByText(/You do not have the right permissions/),
      ).toBeTruthy();
      expect(createOperations).not.toHaveBeenCalled();
      expect(screen.queryByTestId('loading-spinner')).toBeNull();
    },
  );

  it.each([null, 'primary_only'])(
    'uses effective all-environment access inherited by a role with local access %s',
    async (environmentsAccess) => {
      const service = operations();
      createOperations.mockReturnValue(service);
      render(
        <AssetDeletionSidebar
          ctx={
            context({ environmentsAccess, finalEnvironmentsAccess: 'all' }).ctx
          }
        />,
      );

      expect(
        await screen.findByText(/This is the last remaining copy/),
      ).toBeTruthy();
      expect(createOperations).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText(/You do not have the right permissions/),
      ).toBeNull();
    },
  );

  it('does not use local access when the effective role restricts environments', () => {
    render(
      <AssetDeletionSidebar
        ctx={
          context({
            environmentsAccess: 'all',
            finalEnvironmentsAccess: 'primary_only',
          }).ctx
        }
      />,
    );

    expect(
      screen.getByText(/You do not have the right permissions/),
    ).toBeTruthy();
    expect(createOperations).not.toHaveBeenCalled();
  });
});

describe('single-asset deletion results and confirmation', () => {
  it('removes only confirmed deleted or absent copies, retains failed copies, and does not reload', async () => {
    const matches = ['deleted-copy', 'already-absent-copy', 'failed-copy'].map(
      environment,
    );
    const service = operations(matches);
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: ['deleted-copy'],
      absentEnvIds: ['already-absent-copy'],
      failures: [
        {
          envId: 'failed-copy',
          message:
            'Asset is used by records in this environment and cannot be deleted.',
        },
      ],
    });
    createOperations.mockReturnValue(service);
    const { ctx, notice, openConfirm } = context();
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'deleted-copy' });
    fireEvent.click(deleteButton());

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete 3 other copies?' }),
    );
    expect(service.deleteCopies).toHaveBeenCalledWith(
      matches,
      ctx.upload.id,
      ctx.environment,
      expect.any(Function),
    );
    expect(screen.queryByRole('link', { name: 'deleted-copy' })).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'already-absent-copy' }),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'failed-copy' })).toBeTruthy();
    expect(
      screen.getByText(/failed-copy: Asset is used by records/),
    ).toBeTruthy();
    expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
    expect(deleteButton().textContent).toContain('1 other env(s)');
    expect(notice).toHaveBeenCalledWith(
      'Deleted 1 other copies. 1 copies confirmed already absent. Some environments could not be completed. See the remaining copies and errors in this panel.',
    );
    expect(service.listEnvironments).toHaveBeenCalledTimes(1);
    expect(service.checkEnvironments).toHaveBeenCalledTimes(1);
    expect(createOperations).toHaveBeenCalledTimes(1);
  });

  it('reports a complete deletion and keeps the current copy for manual removal', async () => {
    const service = operations([environment('other-copy')]);
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: ['other-copy'],
      absentEnvIds: [],
      failures: [],
    });
    createOperations.mockReturnValue(service);
    const { ctx, notice } = context();
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'other-copy' });
    fireEvent.click(deleteButton());

    expect(
      await screen.findByText(/This is the last remaining copy/),
    ).toBeTruthy();
    expect(notice).toHaveBeenCalledWith(
      'Deleted 1 other copies. You must delete the last copy in the current environment manually.',
    );
    expect(service.deleteCopies.mock.calls[0][0].map((env) => env.id)).toEqual([
      'other-copy',
    ]);
    expect(
      screen.queryByRole('button', { name: /^Delete this asset from/ }),
    ).toBeNull();
  });

  it('reports already absent copies without counting them as new deletions', async () => {
    const service = operations([environment('other-copy')]);
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: [],
      absentEnvIds: ['other-copy'],
      failures: [],
    });
    createOperations.mockReturnValue(service);
    const { ctx, notice } = context();
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'other-copy' });
    fireEvent.click(deleteButton());

    expect(
      await screen.findByText(/This is the last remaining copy/),
    ).toBeTruthy();
    expect(notice).toHaveBeenCalledWith(
      'Deleted 0 other copies. 1 copies confirmed already absent. You must delete the last copy in the current environment manually.',
    );
  });

  it('preserves unresolved lookup errors after deleting all known copies', async () => {
    const service = operations([environment('known-copy')]);
    service.checkEnvironments.mockResolvedValue({
      matches: [environment('known-copy')],
      failures: [{ envId: 'unknown-copy', message: 'HTTP 403' }],
    });
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: ['known-copy'],
      absentEnvIds: [],
      failures: [],
    });
    createOperations.mockReturnValue(service);
    const { ctx, notice } = context();
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'known-copy' });
    fireEvent.click(deleteButton());

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('link', { name: 'known-copy' })).toBeNull();
    expect(screen.getByText('unknown-copy: HTTP 403')).toBeTruthy();
    expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
    expect(notice).toHaveBeenCalledWith(
      'Deleted 1 other copies. Some environments could not be completed. See the remaining copies and errors in this panel.',
    );
  });

  it('does not overwrite confirmed results when notifying the dashboard fails', async () => {
    const service = operations([environment('other-copy')]);
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: ['other-copy'],
      absentEnvIds: [],
      failures: [],
    });
    createOperations.mockReturnValue(service);
    const { ctx, notice } = context();
    notice.mockRejectedValue(new Error('Synthetic notice failure'));
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'other-copy' });
    fireEvent.click(deleteButton());

    expect(
      await screen.findByText(/This is the last remaining copy/),
    ).toBeTruthy();
    expect(screen.queryByText(/Could not check every environment/)).toBeNull();
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
    expect(service.deleteCopies).toHaveBeenCalledTimes(1);
  });

  it('finishes deletion feedback without waiting for a pending dashboard notice', async () => {
    const pendingNotice = deferred<void>();
    const service = operations([environment('failed-copy')]);
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: [],
      absentEnvIds: [],
      failures: [{ envId: 'failed-copy', message: 'HTTP 403' }],
    });
    createOperations.mockReturnValue(service);
    const { ctx, notice } = context();
    notice.mockReturnValue(pendingNotice.promise);
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'failed-copy' });
    fireEvent.click(deleteButton());

    await screen.findByText('failed-copy: HTTP 403');
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('loading-spinner')).toBeNull();
    expect(notice).toHaveBeenCalledTimes(1);
    await act(async () => pendingNotice.resolve());
  });

  it('does not create duplicate confirmations or deletions on a double click', async () => {
    const pendingConfirmation = deferred<string | null>();
    const service = operations([environment('other-copy')]);
    createOperations.mockReturnValue(service);
    const { ctx, openConfirm } = context();
    openConfirm.mockReturnValue(pendingConfirmation.promise);
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'other-copy' });
    const button = deleteButton();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(openConfirm).toHaveBeenCalledTimes(1);
    expect(service.deleteCopies).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pendingConfirmation.resolve('deleteAll'));
    expect(service.deleteCopies).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh confirmation after the user cancels without deleting anything', async () => {
    const service = operations([environment('other-copy')]);
    createOperations.mockReturnValue(service);
    const { ctx, openConfirm } = context();
    openConfirm.mockResolvedValueOnce('cancel');
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'other-copy' });
    fireEvent.click(deleteButton());
    await waitFor(() =>
      expect((deleteButton() as HTMLButtonElement).disabled).toBe(false),
    );
    expect(service.deleteCopies).not.toHaveBeenCalled();
    fireEvent.click(deleteButton());
    await waitFor(() => expect(service.deleteCopies).toHaveBeenCalledTimes(1));
    expect(openConfirm).toHaveBeenCalledTimes(2);
  });

  it('recovers from a failed confirmation and identifies the last copy after a successful new action', async () => {
    const service = operations([environment('other-copy')]);
    service.deleteCopies.mockResolvedValue({
      deletedEnvIds: ['other-copy'],
      absentEnvIds: [],
      failures: [],
    });
    createOperations.mockReturnValue(service);
    const { ctx, openConfirm } = context();
    openConfirm.mockRejectedValueOnce(
      new Error('Synthetic confirmation failure'),
    );
    render(<AssetDeletionSidebar ctx={ctx} />);
    await screen.findByRole('link', { name: 'other-copy' });
    fireEvent.click(deleteButton());

    const errorMessage =
      'Could not complete the request. Check your connection and access permissions.';
    expect(await screen.findByText(errorMessage)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'other-copy' })).toBeTruthy();
    expect(screen.queryByText(/Could not check every environment/)).toBeNull();
    expect(service.deleteCopies).not.toHaveBeenCalled();
    expect((deleteButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(deleteButton());

    expect(
      await screen.findByText(/This is the last remaining copy/),
    ).toBeTruthy();
    expect(screen.queryByText(errorMessage)).toBeNull();
    expect(service.deleteCopies).toHaveBeenCalledTimes(1);
    expect(openConfirm).toHaveBeenCalledTimes(2);
  });
});

const contextChanges = [
  { label: 'asset', options: { uploadId: 'next-upload' } },
  { label: 'environment', options: { environment: 'next-environment' } },
  { label: 'token', options: { apiToken: 'next-synthetic-token' } },
];

describe.each(contextChanges)(
  'changing the $label during pending work',
  ({ options }) => {
    it('aborts the old lookup and ignores its late result and progress', async () => {
      const pendingLookup = deferred<LookupResult>();
      const oldService = operations();
      oldService.checkEnvironments.mockReturnValue(pendingLookup.promise);
      const newService = operations([environment('fresh-copy')]);
      createOperations
        .mockReturnValueOnce(oldService)
        .mockReturnValueOnce(newService);
      const oldContext = context();
      const newContext = context(options);
      const view = render(<AssetDeletionSidebar ctx={oldContext.ctx} />);
      await waitFor(() =>
        expect(oldService.checkEnvironments).toHaveBeenCalledTimes(1),
      );
      const oldSignal = createOperations.mock.calls[0][0].signal;
      view.rerender(<AssetDeletionSidebar ctx={newContext.ctx} />);
      await screen.findByRole('link', { name: 'fresh-copy' });

      expect(oldSignal.aborted).toBe(true);
      await act(async () => {
        oldService.checkEnvironments.mock.calls[0][3]?.({
          completed: 10,
          total: 1_200,
        });
        pendingLookup.resolve({
          matches: [],
          failures: [{ envId: 'stale-error', message: 'Late failure' }],
        });
      });
      expect(screen.getByRole('link', { name: 'fresh-copy' })).toBeTruthy();
      expect(screen.queryByText(/stale-error/)).toBeNull();
      expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
      expect(screen.queryByTestId('loading-spinner')).toBeNull();
      expect(newService.checkEnvironments).toHaveBeenCalledWith(
        [environment('fresh-copy')],
        newContext.ctx.upload.id,
        newContext.ctx.environment,
        expect.any(Function),
      );
    });

    it('aborts the old confirmation and never mutates after it is confirmed late', async () => {
      const pendingConfirmation = deferred<string | null>();
      const oldService = operations([environment('shared-copy')]);
      const newService = operations([environment('shared-copy')]);
      createOperations
        .mockReturnValueOnce(oldService)
        .mockReturnValueOnce(newService);
      const oldContext = context();
      oldContext.openConfirm.mockReturnValue(pendingConfirmation.promise);
      const newContext = context(options);
      const view = render(<AssetDeletionSidebar ctx={oldContext.ctx} />);
      await screen.findByRole('link', { name: 'shared-copy' });
      fireEvent.click(deleteButton());
      expect(oldContext.openConfirm).toHaveBeenCalledTimes(1);
      const oldSignal = createOperations.mock.calls[0][0].signal;
      view.rerender(<AssetDeletionSidebar ctx={newContext.ctx} />);
      await screen.findByRole('link', { name: 'shared-copy' });
      await act(async () => pendingConfirmation.resolve('deleteAll'));

      expect(oldSignal.aborted).toBe(true);
      expect(oldService.deleteCopies).not.toHaveBeenCalled();
      expect(newService.deleteCopies).not.toHaveBeenCalled();
      expect(oldContext.notice).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: 'shared-copy' })).toBeTruthy();
      expect((deleteButton() as HTMLButtonElement).disabled).toBe(false);
    });

    it('aborts the old deletion and keeps new matches when results and progress arrive late', async () => {
      const pendingDeletion = deferred<DeleteResult>();
      const oldService = operations([environment('shared-copy')]);
      oldService.deleteCopies.mockReturnValue(pendingDeletion.promise);
      const newService = operations([environment('shared-copy')]);
      createOperations
        .mockReturnValueOnce(oldService)
        .mockReturnValueOnce(newService);
      const oldContext = context();
      const newContext = context(options);
      const view = render(<AssetDeletionSidebar ctx={oldContext.ctx} />);
      await screen.findByRole('link', { name: 'shared-copy' });
      fireEvent.click(deleteButton());
      await waitFor(() =>
        expect(oldService.deleteCopies).toHaveBeenCalledTimes(1),
      );
      const oldSignal = createOperations.mock.calls[0][0].signal;
      view.rerender(<AssetDeletionSidebar ctx={newContext.ctx} />);
      await screen.findByRole('link', { name: 'shared-copy' });
      await act(async () => {
        oldService.deleteCopies.mock.calls[0][3]?.({
          completed: 1,
          total: 1_200,
        });
        pendingDeletion.resolve({
          deletedEnvIds: ['shared-copy'],
          absentEnvIds: [],
          failures: [],
        });
      });

      expect(oldSignal.aborted).toBe(true);
      expect(screen.getByRole('link', { name: 'shared-copy' })).toBeTruthy();
      expect(screen.queryByText(/This is the last remaining copy/)).toBeNull();
      expect(screen.queryByTestId('loading-spinner')).toBeNull();
      expect(oldContext.notice).not.toHaveBeenCalled();
      expect(newContext.notice).not.toHaveBeenCalled();
      expect(newService.deleteCopies).not.toHaveBeenCalled();
      expect((deleteButton() as HTMLButtonElement).disabled).toBe(false);
    });
  },
);
