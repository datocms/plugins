import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionLocalFiles, getSessionLocalFile } from '../lib/localFiles';
import type { AgentMentionHost } from '../lib/mentionHost';
import {
  type AgentComposerSubmission,
  fallbackAssetMention,
  fallbackRecordMention,
} from '../lib/mentions';
import type { NavigationCallbacks } from '../recordComments/entrypoints/contexts/NavigationCallbacksContext';
import { MentionComposer } from './MentionComposer';

vi.mock('datocms-react-ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('datocms-react-ui')>();
  const PassThrough = ({ children }: { children?: ReactNode }) => children;
  return {
    ...original,
    Tooltip: PassThrough,
    TooltipContent: () => null,
    TooltipTrigger: PassThrough,
  };
});

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
  handleOpenFile: vi.fn(),
  handleOpenRecord: vi.fn(),
};

function createHost(
  overrides: Partial<AgentMentionHost> = {},
): AgentMentionHost {
  return {
    currentUser,
    projectOwnerId: 'project-owner',
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
    resolveAsset: vi.fn(async ({ uploadId, label }) =>
      fallbackAssetMention(uploadId, label || `Asset #${uploadId}`),
    ),
    resolveRecord: vi.fn(async ({ itemId, label }) =>
      fallbackRecordMention({
        id: itemId,
        title: label || `Record #${itemId}`,
      }),
    ),
    openUser: vi.fn(),
    openModel: vi.fn(),
    openLocalFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderComposer(
  host: AgentMentionHost,
  options: {
    currentRecordId?: string;
    disabled?: boolean;
    onSubmit?: (submission: AgentComposerSubmission) => void;
  } = {},
) {
  return render(
    <MentionComposer
      currentRecordId={options.currentRecordId}
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
  clearSessionLocalFiles();
});

describe('MentionComposer', () => {
  it('adds multiple computer files as references and submits metadata without embedding bytes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderComposer(createHost({ canMentionAssets: false }), { onSubmit });

    const input = screen.getByLabelText('Choose files from computer');
    const click = vi.spyOn(input, 'click');
    const fileButton = screen.getByRole('button', {
      name: 'Upload files from computer',
    });
    const sendButton = screen.getByRole('button', { name: 'Send' });
    const assetButton = screen.getByRole('button', {
      name: 'Asset mentions unavailable - no upload permissions',
    });
    expect(fileButton.parentElement?.parentElement).toBe(
      sendButton.parentElement?.parentElement,
    );
    expect(fileButton.parentElement?.parentElement).not.toBe(
      assetButton.parentElement?.parentElement,
    );
    expect(
      fileButton.compareDocumentPosition(sendButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(fileButton);
    expect(click).toHaveBeenCalledOnce();

    const pdf = new File(['PDF bytes'], 'brief.pdf', {
      type: 'application/pdf',
      lastModified: 1_786_000_000_000,
    });
    const notes = new File(['Some notes'], 'notes.txt', {
      type: 'text/plain',
      lastModified: 1_786_000_001_000,
    });
    await user.upload(input, [pdf, notes]);

    expect(screen.getByText('brief.pdf')).toBeVisible();
    expect(screen.getByText('notes.txt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    const fileMentions = submission.segments.flatMap((segment) =>
      segment.type === 'mention' && segment.mention.type === 'file'
        ? [segment.mention]
        : [],
    );
    expect(fileMentions).toHaveLength(2);
    expect(submission.attachments).toEqual(
      fileMentions.map(({ type: _type, ...descriptor }) => descriptor),
    );
    expect(Object.keys(submission.attachments?.[0] ?? {}).sort()).toEqual([
      'filename',
      'id',
      'lastModified',
      'mimeType',
      'size',
    ]);
    expect(getSessionLocalFile(fileMentions[0].id)).toBe(pdf);
    expect(getSessionLocalFile(fileMentions[1].id)).toBe(notes);
    expect(submission.providerText).toContain(
      'HOST-ATTACHED LOCAL FILES (NOT DATOCMS ASSETS)',
    );
  });

  it('shows a drop state and attaches files dropped anywhere in the chat', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderComposer(createHost(), { onSubmit });
    const file = new File(['Campaign brief'], 'drop.pdf', {
      type: 'application/pdf',
    });
    const dataTransfer = {
      dropEffect: 'none',
      files: [file],
      types: ['Files'],
    };

    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText('Drop the file here')).toBeVisible();

    fireEvent.dragOver(window, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');

    fireEvent.drop(window, { dataTransfer });
    expect(screen.queryByText('Drop the file here')).not.toBeInTheDocument();
    expect(await screen.findByText('drop.pdf')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    const attachment = submission.attachments?.[0];
    expect(attachment?.filename).toBe('drop.pdf');
    expect(getSessionLocalFile(attachment?.id ?? '')).toBe(file);
  });

  it('removes an attached computer file from the composer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderComposer(createHost(), { onSubmit });
    const input = screen.getByLabelText('Choose files from computer');

    await user.upload(
      input,
      new File(['Draft brief'], 'draft-brief.pdf', {
        type: 'application/pdf',
      }),
    );

    const removeButton = await screen.findByRole('button', {
      name: 'Remove draft-brief.pdf',
    });
    expect(removeButton).toBeVisible();
    await user.click(removeButton);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove draft-brief.pdf' }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not show or accept file drops while the composer is disabled', () => {
    renderComposer(createHost(), { disabled: true });
    const file = new File(['Draft'], 'draft.txt', { type: 'text/plain' });
    const dataTransfer = {
      dropEffect: 'copy',
      files: [file],
      types: ['Files'],
    };

    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.queryByText('Drop the file here')).not.toBeInTheDocument();
    fireEvent.drop(window, { dataTransfer });
    expect(screen.queryByText('draft.txt')).not.toBeInTheDocument();
  });

  it('rejects empty, oversized, and excess local files before registration', async () => {
    const user = userEvent.setup();
    renderComposer(createHost());
    const input = screen.getByLabelText('Choose files from computer');
    const validFiles = Array.from(
      { length: 6 },
      (_, index) => new File(['x'], `valid-${index + 1}.txt`),
    );
    const empty = new File([], 'empty.txt', { type: 'text/plain' });
    const oversizedImage = new File(['x'], 'huge.png', {
      type: 'image/png',
    });
    Object.defineProperty(oversizedImage, 'size', {
      value: 10 * 1024 * 1024 + 1,
    });

    await user.upload(input, [...validFiles, empty, oversizedImage]);

    expect(screen.getByText('valid-5.txt')).toBeVisible();
    expect(screen.queryByText('valid-6.txt')).not.toBeInTheDocument();
    expect(screen.queryByText('empty.txt')).not.toBeInTheDocument();
    expect(screen.queryByText('huge.png')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Empty files cannot be attached.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Images must be 10 MB or smaller',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A message can include up to 5 files',
    );
  });

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

    expect(screen.getByText('Locale · Title')).toBeVisible();
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByText('Locale · Title')).not.toBeInTheDocument();

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

  it('selects toolbar mention options through ordinary button clicks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost();
    renderComposer(host, { onSubmit });

    await user.click(screen.getByRole('button', { name: 'Mention user' }));
    await user.click(
      await screen.findByRole('menuitem', { name: /Bob Builder/ }),
    );

    await user.click(screen.getByRole('button', { name: 'Mention model' }));
    await user.click(screen.getByRole('menuitem', { name: /Page\$page/ }));

    await user.click(screen.getByRole('button', { name: 'Mention field' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Summary#summary' }),
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    expect(
      submission.segments.flatMap((segment) =>
        segment.type === 'mention' ? [segment.mention.type] : [],
      ),
    ).toEqual(['user', 'model', 'field']);
  });

  it('removes an abandoned user command when switching to a record reference', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost({
      selectRecord: vi.fn(async () => ({
        type: 'record' as const,
        id: 'homepage',
        title: 'Homepage',
        modelId: pageModel.id,
        modelApiKey: pageModel.apiKey,
        modelName: pageModel.name,
        modelEmoji: null,
        thumbnailUrl: null,
      })),
    });
    renderComposer(host, { onSubmit });

    const editor = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    await user.click(screen.getByRole('button', { name: 'Mention user' }));
    expect(await screen.findByRole('menu', { name: 'People' })).toBeVisible();
    expect(editor).toHaveTextContent('/user');

    await user.click(screen.getByRole('button', { name: 'Mention record' }));

    expect(
      screen.queryByRole('menu', { name: 'People' }),
    ).not.toBeInTheDocument();
    expect(editor).not.toHaveTextContent('/user');
    expect(
      screen.getByRole('textbox', { name: 'Search record models' }),
    ).toBeVisible();

    await user.click(screen.getByRole('menuitem', { name: /Page\$page/ }));
    expect(await screen.findByText('Homepage')).toBeVisible();
    expect(editor).not.toHaveTextContent('/user');

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    expect(
      submission.segments.flatMap((segment) =>
        segment.type === 'mention' ? [segment.mention.type] : [],
      ),
    ).toEqual(['record']);
  });

  it('replaces a pending toolbar command when another reference type is chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderComposer(createHost(), { onSubmit });

    const editor = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    await user.click(screen.getByRole('button', { name: 'Mention user' }));
    expect(await screen.findByRole('menu', { name: 'People' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Mention model' }));

    expect(
      screen.queryByRole('menu', { name: 'People' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Models' })).toBeVisible();
    expect(editor).not.toHaveTextContent('/user');
    expect(editor).toHaveTextContent('/model');

    await user.click(screen.getByRole('menuitem', { name: /Page\$page/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const submission = onSubmit.mock.calls[0]?.[0] as AgentComposerSubmission;
    expect(
      submission.segments.flatMap((segment) =>
        segment.type === 'mention' ? [segment.mention.type] : [],
      ),
    ).toEqual(['model']);
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

  it('keeps a reference to the currently open record disabled', async () => {
    const user = userEvent.setup();
    const handleOpenRecord = vi.mocked(navigation.handleOpenRecord);
    handleOpenRecord.mockClear();
    const host = createHost({
      selectRecord: vi.fn(async () => ({
        type: 'record' as const,
        id: 'homepage',
        title: 'Homepage',
        modelId: pageModel.id,
        modelApiKey: pageModel.apiKey,
        modelName: pageModel.name,
        modelEmoji: null,
        thumbnailUrl: null,
      })),
    });
    renderComposer(host, { currentRecordId: 'homepage' });

    await user.click(screen.getByRole('button', { name: 'Mention record' }));
    await user.click(screen.getByText('Page'));

    const currentRecord = await screen.findByRole('button', {
      name: 'Current record: Homepage',
    });
    expect(currentRecord).toBeDisabled();
    fireEvent.click(currentRecord);
    expect(handleOpenRecord).not.toHaveBeenCalled();
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
