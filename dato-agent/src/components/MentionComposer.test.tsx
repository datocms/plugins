import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionLocalFiles, getSessionLocalFile } from '../lib/localFiles';
import type { AgentMentionHost } from '../lib/mentionHost';
import {
  type AgentComposerSubmission,
  fallbackAssetMention,
  fallbackRecordMention,
} from '../lib/mentions';
import type { NavigationCallbacks } from '../recordComments/entrypoints/contexts/NavigationCallbacksContext';
import { fakeCtx, renderInCanvas } from '../test/canvas';
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
    isRunning?: boolean;
    onStop?: () => void;
    onSubmit?: (submission: AgentComposerSubmission) => void;
  } = {},
) {
  const ctx = fakeCtx();
  const view = renderInCanvas(
    <MentionComposer
      currentRecordId={options.currentRecordId}
      disabled={options.disabled ?? false}
      host={host}
      isRunning={options.isRunning ?? false}
      navigation={navigation}
      onStop={options.onStop}
      onSubmit={options.onSubmit ?? vi.fn()}
      placeholder="Ask about this project…"
    />,
    ctx,
  );
  return { ...view, alert: vi.mocked(ctx.alert) };
}

/** The hidden input of the file dialog that "Attach files" opens */
function fileInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('The composer has no file input');
  return input;
}

function messageTextbox() {
  return screen.getByRole('textbox', { name: 'Message the DatoCMS agent' });
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
    const { container } = renderComposer(
      createHost({ canMentionAssets: false }),
      { onSubmit },
    );

    const input = fileInput(container);
    const click = vi.spyOn(input, 'click');
    const toolbar = screen.getByRole('toolbar', { name: 'Insert' });
    const fileButton = within(toolbar).getByRole('button', {
      name: 'Attach files',
    });
    // Without the upload permission, assets can't be referenced, but files
    // from the computer can still be attached
    expect(
      within(toolbar).getByRole('button', {
        name: 'Mentioning assets needs the upload permission.',
      }),
    ).toHaveAttribute('aria-disabled', 'true');
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(toolbar).not.toContainElement(sendButton);
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
    const cue = screen.getByText('Drop files to attach');
    expect(cue).toBeVisible();
    // Screen readers hear the cue too
    expect(cue.closest('[role="status"]')).not.toBeNull();
    // The cue is the kit's drop target, over the whole frame
    expect(cue.closest('.DropTarget')).toHaveClass(
      'is-over',
      'DropTarget--ring-only',
    );

    fireEvent.dragOver(window, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');

    fireEvent.drop(window, { dataTransfer });
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();
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
    const { container } = renderComposer(createHost(), { onSubmit });

    await user.upload(
      fileInput(container),
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

    // The draft is empty again: Send says why it does nothing
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    await user.click(send);
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
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();
    fireEvent.dragOver(window, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('none');
    // The browser must not open the dropped file in the frame
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(screen.queryByText('draft.txt')).not.toBeInTheDocument();
  });

  it('rejects empty, oversized, and excess local files before registration', async () => {
    const user = userEvent.setup();
    const { alert, container } = renderComposer(createHost());
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

    await user.upload(fileInput(container), [
      ...validFiles,
      empty,
      oversizedImage,
    ]);

    expect(screen.getByText('valid-5.txt')).toBeVisible();
    expect(screen.queryByText('valid-6.txt')).not.toBeInTheDocument();
    expect(screen.queryByText('empty.txt')).not.toBeInTheDocument();
    expect(screen.queryByText('huge.png')).not.toBeInTheDocument();
    // The refusals are one toast of the host, not text in the frame
    expect(alert).toHaveBeenCalledOnce();
    const message = alert.mock.calls[0]?.[0];
    expect(message).toContain('Empty files cannot be attached.');
    expect(message).toContain('Images must be 10 MB or smaller');
    expect(message).toContain('A message can include up to 5 files');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error on the field and keeps Send off for a message that is too long', async () => {
    const onSubmit = vi.fn();
    renderComposer(createHost(), { onSubmit });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'true');

    pasteText(messageTextbox(), 'x'.repeat(20_001));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(
      'This message is too long. Remove some text or references.',
    );
    const editor = messageTextbox();
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor.getAttribute('aria-describedby')).toContain(error.id);
    expect(send).toHaveAttribute('aria-disabled', 'true');

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('turns Send into Stop while the agent runs', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const view = renderComposer(createHost(), { isRunning: true, onStop });

    expect(
      screen.queryByRole('button', { name: 'Send' }),
    ).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: 'Stop' });
    // An icon button: its label is its name and its tooltip, not text
    expect(stop).not.toHaveTextContent('Stop');
    await user.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    expect(messageTextbox()).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(screen.getByRole('toolbar', { name: 'Insert' })).getByRole(
        'button',
        { name: 'Mention a user' },
      ),
    ).toHaveAttribute('aria-disabled', 'true');

    view.rerender(
      <MentionComposer
        disabled={false}
        host={createHost()}
        isRunning
        navigation={navigation}
        onSubmit={vi.fn()}
        placeholder="Ask about this project…"
      />,
    );
    // Without a way to stop the turn, Stop stays in place, disabled, and
    // says why
    const disabledStop = screen.getByRole('button', { name: 'Stop' });
    expect(disabledStop).toHaveAttribute('aria-disabled', 'true');
    fireEvent.focus(disabledStop);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'This turn can’t be stopped.',
    );
    await user.click(disabledStop);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('says on Send why a disabled composer is off', () => {
    const ctx = fakeCtx();
    renderInCanvas(
      <MentionComposer
        disabled
        disabledReason="Approve or deny the proposed change first."
        host={createHost()}
        isRunning={false}
        navigation={navigation}
        onSubmit={vi.fn()}
        placeholder="Review the proposed change before continuing"
      />,
      ctx,
    );

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).not.toHaveTextContent('Send');
    expect(send).toHaveAttribute('aria-disabled', 'true');
    // The reason is the tooltip of the disabled button
    fireEvent.focus(send);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Approve or deny the proposed change first.',
    );
  });

  it('shows the insert toolbar only while the editor or one of its menus has the focus', async () => {
    const user = userEvent.setup();
    renderComposer(createHost());
    // The kit shows an editor toolbar with this class
    const toolbar = screen.getByRole('toolbar', { name: 'Insert' })
      .parentElement as HTMLElement;
    expect(toolbar).not.toHaveClass('is-visible');

    await user.click(messageTextbox());
    await waitFor(() => expect(toolbar).toHaveClass('is-visible'));

    // The record dropdown takes the focus in its search and keeps the
    // toolbar while its menu is open
    await user.click(within(toolbar).getByRole('button', { name: 'Record' }));
    const menu = await screen.findByRole('menu', { name: 'Record' });
    expect(within(menu).getByPlaceholderText('Search...')).toHaveFocus();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(toolbar).toHaveClass('is-visible');

    // Escape closes the menu and gives the focus back to its trigger, in
    // the toolbar. The menu matches its keys by key code (is-hotkey), which
    // user-event leaves out in jsdom.
    fireEvent.keyDown(document.activeElement as Element, {
      key: 'Escape',
      keyCode: 27,
      which: 27,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('menu', { name: 'Record' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(toolbar).getByRole('button', { name: 'Record' }),
    ).toHaveFocus();
    expect(toolbar).toHaveClass('is-visible');

    await user.click(document.body);
    await waitFor(() => expect(toolbar).not.toHaveClass('is-visible'));
  });

  it('picks a record model in the dropdown of the toolbar, with its search', async () => {
    const user = userEvent.setup();
    const host = createHost({
      recordModels: [
        pageModel,
        {
          id: 'release-model',
          apiKey: 'news_item',
          name: 'Press release',
          isBlockModel: false,
        },
        {
          id: 'hero-block',
          apiKey: 'hero_block',
          name: 'Hero',
          isBlockModel: true,
        },
      ],
    });
    renderComposer(host);

    const trigger = screen.getByRole('button', { name: 'Record' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // A picker with a trigger is a real menu: the models of records, under
    // the title of their kind (block models have no records)
    const menu = await screen.findByRole('menu', { name: 'Record' });
    expect(within(menu).getByText('Records').querySelector('svg')).not.toBe(
      null,
    );
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Pagepage', 'Press releasenews_item']);

    // The search of the menu finds a model by its API key too
    await user.type(within(menu).getByPlaceholderText('Search...'), 'NEWS_');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Press releasenews_item']);
    await user.type(within(menu).getByPlaceholderText('Search...'), 'x');
    expect(within(menu).getByRole('status')).toHaveTextContent(
      'No models match “NEWS_x”',
    );
    await user.keyboard('{Backspace}');

    await user.click(within(menu).getByRole('menuitem', { name: /^Press/ }));
    await waitFor(() =>
      expect(host.selectRecord).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'release-model' }),
      ),
    );
    // The menu closes with the pick (after its short closing animation)
    await waitFor(() =>
      expect(
        screen.queryByRole('menu', { name: 'Record' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('says in the record dropdown when no model can be read', async () => {
    const user = userEvent.setup();
    renderComposer(
      createHost({
        recordModels: [
          {
            id: 'hero-block',
            apiKey: 'hero_block',
            name: 'Hero',
            isBlockModel: true,
          },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Record' }));

    const menu = await screen.findByRole('menu', { name: 'Record' });
    expect(within(menu).getByRole('status')).toHaveTextContent(
      'No models you can read',
    );
    // Nothing to search
    expect(within(menu).queryByPlaceholderText('Search...')).toBeNull();
  });

  it('puts the mention entries and the attach button in one group, in the order of the "/" command', () => {
    renderComposer(createHost());
    const toolbar = screen.getByRole('toolbar', { name: 'Insert' });

    expect(
      within(toolbar)
        .getAllByRole('button')
        .map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
    ).toEqual([
      'Mention a user',
      'Mention a field',
      'Record',
      'Mention an asset',
      'Mention a model',
      'Attach files',
    ]);
  });

  it('disables the references that the user may not make and says why', async () => {
    const user = userEvent.setup();
    const host = createHost({
      canMentionAssets: false,
      canMentionFields: false,
      canMentionModels: false,
    });
    renderComposer(host);
    const toolbar = screen.getByRole('toolbar', { name: 'Insert' });

    // Fields exist only next to a record: no button. Assets and models stay
    // in view, and their label is the reason
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
    ).toEqual([
      'Mention a user',
      'Record',
      'Mentioning assets needs the upload permission.',
      'Mentioning models needs schema access.',
      'Attach files',
    ]);

    const asset = within(toolbar).getByRole('button', {
      name: 'Mentioning assets needs the upload permission.',
    });
    const model = within(toolbar).getByRole('button', {
      name: 'Mentioning models needs schema access.',
    });
    expect(asset).toHaveAttribute('aria-disabled', 'true');
    expect(model).toHaveAttribute('aria-disabled', 'true');

    await user.click(asset);
    await user.click(model);
    expect(host.selectAsset).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Models' })).toBeNull();
    expect(messageTextbox()).not.toHaveTextContent('/model');
  });

  it('opens a panel of the record models from the "/" command', async () => {
    const user = userEvent.setup();
    const host = createHost();
    renderComposer(host);

    // The "/" is typed in the editor, which has the focus
    await user.click(messageTextbox());
    pasteText(messageTextbox(), '/');
    await user.click(await screen.findByRole('menuitem', { name: /^Record/ }));

    // The panel is a step of the command, next to the editor: its search
    // has the focus and the first model is highlighted
    expect(await screen.findByRole('menu', { name: 'Records' })).toBeVisible();
    const search = screen.getByRole('textbox', {
      name: 'Search record models',
    });
    expect(search).toHaveFocus();
    // The search is not the input of the message field around it
    expect(search).not.toHaveAttribute('aria-describedby');
    // The editor does not take the focus back a frame later
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(search).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(host.selectRecord).toHaveBeenCalledWith(pageModel),
    );
    expect(
      screen.queryByRole('menu', { name: 'Records' }),
    ).not.toBeInTheDocument();
  });

  it('closes the panel of the record models with Escape, back to the editor', async () => {
    const user = userEvent.setup();
    renderComposer(createHost());

    await user.click(messageTextbox());
    pasteText(messageTextbox(), '/');
    await user.click(await screen.findByRole('menuitem', { name: /^Record/ }));
    expect(await screen.findByRole('menu', { name: 'Records' })).toBeVisible();

    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('menu', { name: 'Records' }),
    ).not.toBeInTheDocument();
    // The editor takes the focus on the next frame
    await waitFor(() => expect(messageTextbox()).toHaveFocus());
  });

  it('closes the panel of the record models when the toolbar opens another menu', async () => {
    const user = userEvent.setup();
    renderComposer(createHost());

    await user.click(messageTextbox());
    pasteText(messageTextbox(), '/');
    await user.click(await screen.findByRole('menuitem', { name: /^Record/ }));
    expect(await screen.findByRole('menu', { name: 'Records' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Mention a user' }));

    expect(
      screen.queryByRole('menu', { name: 'Records' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('menu', { name: 'People' })).toBeVisible();
  });

  it('filters and selects users from a toolbar-opened menu with the keyboard', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost();
    renderComposer(host, { onSubmit });

    await user.click(screen.getByRole('button', { name: 'Mention a user' }));
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
    expect(host.loadProjectUsers).toHaveBeenCalledOnce();

    const editor = messageTextbox();
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

    await user.click(screen.getByRole('button', { name: 'Mention a field' }));
    expect(await screen.findByText('Title')).toBeVisible();
    expect(host.loadModelFields).toHaveBeenCalledOnce();

    const editor = messageTextbox();
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

    await user.click(screen.getByRole('button', { name: 'Mention a user' }));
    await user.click(
      await screen.findByRole('menuitem', { name: /Bob Builder/ }),
    );

    await user.click(screen.getByRole('button', { name: 'Mention a model' }));
    await user.click(screen.getByRole('menuitem', { name: /^Page/ }));

    await user.click(screen.getByRole('button', { name: 'Mention a field' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Summary/ }));

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

    const editor = messageTextbox();
    await user.click(screen.getByRole('button', { name: 'Mention a user' }));
    expect(await screen.findByRole('menu', { name: 'People' })).toBeVisible();
    expect(editor).toHaveTextContent('/user');
    // The editor takes the focus on the next frame: wait for it, as a user
    // does, so it can't take it back from the search of the record menu
    await waitFor(() => expect(editor).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Record' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('menu', { name: 'People' }),
      ).not.toBeInTheDocument(),
    );
    expect(editor).not.toHaveTextContent('/user');
    // The record dropdown, with the search of its menu
    const menu = screen.getByRole('menu', { name: 'Record' });
    expect(menu).toBeVisible();
    const search = within(menu).getByPlaceholderText('Search...');
    await waitFor(() => expect(search).toHaveFocus());
    // The search field of the menu is not the input of the message field
    expect(search.id).not.toBe(editor.id);
    expect(search).not.toHaveAttribute('aria-describedby');

    await user.click(within(menu).getByRole('menuitem', { name: /^Page/ }));
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

    const editor = messageTextbox();
    await user.click(screen.getByRole('button', { name: 'Mention a user' }));
    expect(await screen.findByRole('menu', { name: 'People' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Mention a model' }));

    expect(
      screen.queryByRole('menu', { name: 'People' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Models' })).toBeVisible();
    expect(editor).not.toHaveTextContent('/user');
    expect(editor).toHaveTextContent('/model');

    await user.click(screen.getByRole('menuitem', { name: /^Page/ }));
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

    await user.click(screen.getByRole('button', { name: 'Mention a model' }));
    expect(screen.getByText('Page')).toBeVisible();
    expect(screen.getByText('Secret')).toBeVisible();
    // The editor takes the focus on the next frame: wait for it, as a user
    // does, so it can't take it back from the search of the record menu
    await waitFor(() => expect(messageTextbox()).toHaveFocus());
    fireEvent.keyDown(messageTextbox(), { key: 'Escape' });
    expect(screen.queryByText('Models')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record' }));
    const menu = await screen.findByRole('menu', { name: 'Record' });
    expect(within(menu).getByText('Page')).toBeVisible();
    expect(within(menu).queryByText('Secret')).not.toBeInTheDocument();

    await user.click(within(menu).getByText('Page'));
    await waitFor(() => {
      expect(host.selectRecord).toHaveBeenCalledWith(pageModel);
    });
  });

  it('reports a picker that cannot be opened through the host', async () => {
    const user = userEvent.setup();
    const { alert } = renderComposer(
      createHost({
        selectAsset: vi.fn(async () => {
          throw new Error('Closed');
        }),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Mention an asset' }));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'The asset picker could not be opened.',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Record' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Record' })).getByText(
        'Page',
      ),
    );

    const currentRecord = await screen.findByRole('button', {
      name: 'Homepage',
    });
    expect(currentRecord).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(currentRecord);
    expect(handleOpenRecord).not.toHaveBeenCalled();
  });

  it('does not submit or select a mention while an IME composition is active', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const host = createHost();
    renderComposer(host, { onSubmit });

    await user.click(screen.getByRole('button', { name: 'Mention a user' }));
    expect(await screen.findByText('People')).toBeVisible();
    const editor = messageTextbox();

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

    await user.click(screen.getByRole('button', { name: 'Mention a user' }));
    // The current user is already known, so the menu keeps it and says that
    // the refresh failed; the error is not drawn anywhere else
    expect(await screen.findByText('Couldn’t refresh people.')).toBeVisible();
    expect(
      screen.queryByText('People could not be loaded.'),
    ).not.toBeInTheDocument();

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
    await user.click(screen.getByRole('button', { name: 'Mention an asset' }));
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
    expect(messageTextbox()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(view.alert).not.toHaveBeenCalled();
  });
});
