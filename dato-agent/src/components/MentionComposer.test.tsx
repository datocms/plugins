import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMentionHost } from '../lib/mentionHost';
import type { AgentComposerSubmission } from '../lib/mentions';
import type { NavigationCallbacks } from '../recordComments/entrypoints/contexts/NavigationCallbacksContext';
import { MentionComposer } from './MentionComposer';

const currentUser: AgentMentionHost['currentUser'] = {
  id: 'current-user',
  email: 'editor@example.com',
  name: 'Editor',
  avatarUrl: null,
  userType: 'user',
};

const pageModel: AgentMentionHost['projectModels'][number] = {
  id: 'page-model',
  apiKey: 'page',
  name: 'Page',
  isBlockModel: false,
};

const secretModel: AgentMentionHost['projectModels'][number] = {
  id: 'secret-model',
  apiKey: 'secret',
  name: 'Secret',
  isBlockModel: false,
};

const navigation: NavigationCallbacks = {
  handleOpenAsset: vi.fn(),
  handleOpenRecord: vi.fn(),
};

function createHost(
  overrides: Partial<AgentMentionHost> = {},
): AgentMentionHost {
  return {
    currentUser,
    projectModels: [pageModel, secretModel],
    recordModels: [pageModel],
    canMentionFields: true,
    canMentionAssets: true,
    canMentionModels: true,
    loadProjectUsers: vi.fn(async () => [
      currentUser,
      {
        id: 'ada',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        avatarUrl: null,
        userType: 'user' as const,
      },
      {
        id: 'bob',
        email: 'bob@example.com',
        name: 'Bob Builder',
        avatarUrl: null,
        userType: 'user' as const,
      },
    ]),
    loadModelFields: vi.fn(async () => [
      {
        apiKey: 'title',
        label: 'Title',
        localized: true,
        fieldPath: 'title',
        displayLabel: 'Title',
        depth: 0,
        availableLocales: ['en', 'it'],
        fieldType: 'string',
      },
      {
        apiKey: 'summary',
        label: 'Summary',
        localized: false,
        fieldPath: 'summary',
        displayLabel: 'Summary',
        depth: 0,
        fieldType: 'text',
      },
    ]),
    selectAsset: vi.fn(async () => undefined),
    selectRecord: vi.fn(async () => undefined),
    openUser: vi.fn(),
    openModel: vi.fn(),
    ...overrides,
  };
}

function renderComposer(
  host: AgentMentionHost,
  options: {
    disabled?: boolean;
    onSubmit?: (submission: AgentComposerSubmission) => void;
  } = {},
) {
  return render(
    <MentionComposer
      disabled={options.disabled ?? false}
      host={host}
      isRunning={false}
      navigation={navigation}
      onSubmit={options.onSubmit ?? vi.fn()}
      placeholder="Ask about this project…"
    />,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pasteText(element: HTMLElement, text: string) {
  fireEvent.paste(element, {
    clipboardData: {
      getData: () => text,
      types: ['text/plain'],
    },
  });
}

afterEach(() => {
  cleanup();
});

describe('MentionComposer', () => {
  it('filters and selects users from a toolbar-opened menu with the keyboard', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost();
    renderComposer(host, { onSubmit });

    await user.click(screen.getByRole('button', { name: 'Mention user' }));
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
    expect(host.loadProjectUsers).toHaveBeenCalledOnce();

    const editor = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    pasteText(editor, 'bob');
    expect(screen.getByText('Bob Builder')).toBeVisible();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByText('People')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    expect(
      submission.segments.find((segment) => segment.type === 'mention'),
    ).toEqual({
      type: 'mention',
      mention: {
        type: 'user',
        id: 'bob',
        email: 'bob@example.com',
        name: 'Bob Builder',
        avatarUrl: null,
      },
    });
  });

  it('selects a locale by keyboard for a toolbar-opened field mention', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost();
    renderComposer(host, { onSubmit });

    await user.click(screen.getByRole('button', { name: 'Mention field' }));
    expect(await screen.findByText('Title')).toBeVisible();
    expect(host.loadModelFields).toHaveBeenCalledOnce();

    const editor = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    pasteText(editor, 'tit');
    expect(screen.getByText('Title')).toBeVisible();
    expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(screen.getByText('Select locale for Title')).toBeVisible();
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(
      screen.queryByText('Select locale for Title'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    expect(
      submission.segments.find((segment) => segment.type === 'mention'),
    ).toEqual({
      type: 'mention',
      mention: {
        type: 'field',
        apiKey: 'title',
        label: 'Title',
        localized: true,
        fieldPath: 'title',
        locale: 'it',
        fieldType: 'string',
      },
    });
  });

  it('uses all models for model mentions but only readable models for records', async () => {
    const user = userEvent.setup();
    const host = createHost();
    renderComposer(host);

    await user.click(screen.getByRole('button', { name: 'Mention model' }));
    expect(screen.getByText('Page')).toBeVisible();
    expect(screen.getByText('Secret')).toBeVisible();
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
      { key: 'Escape' },
    );
    expect(screen.queryByText('Models')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mention record' }));
    expect(
      screen.getByRole('textbox', { name: 'Search record models' }),
    ).toBeVisible();
    expect(screen.getByText('Page')).toBeVisible();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();

    await user.click(screen.getByText('Page'));
    await waitFor(() => {
      expect(host.selectRecord).toHaveBeenCalledWith(pageModel);
    });
  });

  it('does not submit or select a mention while an IME composition is active', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost();
    renderComposer(host, { onSubmit });

    await user.click(screen.getByRole('button', { name: 'Mention user' }));
    expect(await screen.findByText('People')).toBeVisible();
    const editor = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });

    const compositionKey = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    Object.defineProperty(compositionKey, 'isComposing', { value: true });
    editor.dispatchEvent(compositionKey);

    expect(screen.getByText('People')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText('@Editor')).not.toBeInTheDocument();
  });

  it('deduplicates user loads, shows retry progress, and blocks late picker insertion when disabled', async () => {
    const user = userEvent.setup();
    const usersRequest = deferred<AgentMentionHost['currentUser'][]>();
    const assetRequest =
      deferred<Awaited<ReturnType<AgentMentionHost['selectAsset']>>>();
    const loadProjectUsers = vi
      .fn<AgentMentionHost['loadProjectUsers']>()
      .mockRejectedValueOnce(new Error('People could not be loaded.'))
      .mockImplementation(() => usersRequest.promise);
    const host = createHost({
      loadProjectUsers,
      selectAsset: vi.fn(() => assetRequest.promise),
    });
    const view = renderComposer(host);

    await user.click(screen.getByRole('button', { name: 'Mention user' }));
    expect(
      await screen.findByText('People could not be loaded.'),
    ).toBeVisible();

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(loadProjectUsers).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Loading people…')).toBeVisible();

    await act(async () => {
      usersRequest.resolve([currentUser]);
      await usersRequest.promise;
    });

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Mention asset' }));
    expect(host.selectAsset).toHaveBeenCalledOnce();

    view.rerender(
      <MentionComposer
        disabled
        host={host}
        isRunning={false}
        navigation={navigation}
        onSubmit={vi.fn()}
        placeholder="Ask about this project…"
      />,
    );

    await act(async () => {
      assetRequest.resolve({
        type: 'asset',
        id: 'asset-1',
        filename: 'Late asset.jpg',
        url: '',
        thumbnailUrl: null,
        mimeType: 'image/jpeg',
      });
      await assetRequest.promise;
    });

    expect(screen.queryByText('Late asset.jpg')).not.toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });
});
