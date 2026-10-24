// @vitest-environment jsdom

import Comment from '@components/Comment';
import CommentActions from '@components/CommentActions';
import FieldMentionDropdown from '@components/FieldMentionDropdown';
import { BlockPickerView } from '@components/field-dropdown/BlockPickerView';
import { FieldListView } from '@components/field-dropdown/FieldListView';
import { LocalePickerView } from '@components/field-dropdown/LocalePickerView';
import { NestedFieldsView } from '@components/field-dropdown/NestedFieldsView';
import ModelMentionDropdown from '@components/ModelMentionDropdown';
import { SlashCommandMenu } from '@components/slash-command/SlashCommandMenu';
import UserMentionDropdown from '@components/UserMentionDropdown';
import { SLASH_COMMANDS } from '@ctypes/slashCommands';
import type { ModelInfo } from '@hooks/useMentions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { act, createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigationProvider } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { ProjectDataProvider } from '@/entrypoints/contexts/ProjectDataContext';
import {
  createResolvedAuthor,
  createResolvedCommentWithReplies,
} from '../fixtures/comments';
import { createCanvasCtx, renderInCanvas } from '../testUtils/canvas';

function clickSequence(button: HTMLButtonElement) {
  button.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
  );
  button.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

function createSidebarFields() {
  return {
    site: { attributes: { internal_domain: 'example.admin.datocms.com' } },
    itemType: { id: 'model-1' },
    item: { id: 'record-1' },
    locale: 'en',
    editUpload: vi.fn(),
    navigateTo: vi.fn(),
    editItem: vi.fn(),
    scrollToField: vi.fn(),
  };
}

describe('dropdown interactions', () => {
  it('fires selection once for mouse interaction paths', () => {
    const onUserSelect = vi.fn();
    const onModelSelect = vi.fn();
    const onFieldSelect = vi.fn();
    const onLocaleSelect = vi.fn();
    const onNestedFieldSelect = vi.fn();
    const onBlockSelect = vi.fn();
    const onSelectEntireField = vi.fn();
    const justClickedInsideRef = { current: false };
    const ctx = createCanvasCtx();

    const userRender = renderInCanvas(
      <UserMentionDropdown
        users={[
          {
            id: 'user-1',
            name: 'John Doe',
            email: 'john@example.com',
            avatarUrl: null,
          },
        ]}
        query=""
        selectedIndex={0}
        onSelect={onUserSelect}
        onClose={vi.fn()}
      />,
      ctx,
    );
    clickSequence(
      userRender.container.querySelector('button') as HTMLButtonElement,
    );
    expect(onUserSelect).toHaveBeenCalledTimes(1);
    userRender.unmount();

    const modelRender = renderInCanvas(
      <ModelMentionDropdown
        models={[
          {
            id: 'model-1',
            apiKey: 'article',
            name: 'Article',
            isBlockModel: false,
          },
        ]}
        query=""
        selectedIndex={0}
        onSelect={onModelSelect}
        onClose={vi.fn()}
      />,
      ctx,
    );
    clickSequence(
      modelRender.container.querySelector('button') as HTMLButtonElement,
    );
    expect(onModelSelect).toHaveBeenCalledTimes(1);
    modelRender.unmount();

    const fieldRender = renderInCanvas(
      <FieldListView
        fields={[
          {
            apiKey: 'title',
            label: 'Title',
            fieldPath: 'title',
            displayLabel: 'Title',
            fieldType: 'string',
            depth: 0,
            localized: false,
            availableLocales: [],
            isBlockContainer: false,
          },
        ]}
        selectedIndex={0}
        onSelect={onFieldSelect}
        selectedRef={createRef()}
        justClickedInsideRef={justClickedInsideRef}
      />,
      ctx,
    );
    clickSequence(
      fieldRender.container.querySelector('button') as HTMLButtonElement,
    );
    expect(onFieldSelect).toHaveBeenCalledTimes(1);
    fieldRender.unmount();

    const localeRender = renderInCanvas(
      <LocalePickerView
        locales={['en']}
        selectedIndex={0}
        onSelect={onLocaleSelect}
        onHover={vi.fn()}
        selectedRef={createRef()}
        justClickedInsideRef={justClickedInsideRef}
      />,
      ctx,
    );
    clickSequence(
      localeRender.container.querySelector('button') as HTMLButtonElement,
    );
    expect(onLocaleSelect).toHaveBeenCalledTimes(1);
    localeRender.unmount();

    const nestedRender = renderInCanvas(
      <NestedFieldsView
        fields={[
          {
            apiKey: 'subtitle',
            label: 'Subtitle',
            fieldPath: 'subtitle',
            displayLabel: 'Subtitle',
            fieldType: 'string',
            depth: 0,
            localized: false,
            availableLocales: [],
            isBlockContainer: false,
          },
        ]}
        selectedIndex={0}
        isLoading={false}
        onSelect={onNestedFieldSelect}
        onHover={vi.fn()}
        selectedRef={createRef()}
        justClickedInsideRef={justClickedInsideRef}
      />,
      ctx,
    );
    clickSequence(
      nestedRender.container.querySelector('button') as HTMLButtonElement,
    );
    expect(onNestedFieldSelect).toHaveBeenCalledTimes(1);
    nestedRender.unmount();

    const blockRender = renderInCanvas(
      <BlockPickerView
        blocks={[{ index: 0, modelId: 'block-1', modelName: 'Hero Block' }]}
        selectedIndex={1}
        isLoading={false}
        onSelectEntireField={onSelectEntireField}
        onSelectBlock={onBlockSelect}
        onHover={vi.fn()}
        selectedRef={createRef()}
        justClickedInsideRef={justClickedInsideRef}
      />,
      ctx,
    );
    const buttons = blockRender.container.querySelectorAll('button');
    clickSequence(buttons[0] as HTMLButtonElement);
    clickSequence(buttons[1] as HTMLButtonElement);
    expect(onSelectEntireField).toHaveBeenCalledTimes(1);
    expect(onBlockSelect).toHaveBeenCalledTimes(1);
    blockRender.unmount();

    const onCommandSelect = vi.fn();
    const slashRender = renderInCanvas(
      <SlashCommandMenu
        commands={SLASH_COMMANDS}
        selectedIndex={0}
        onSelect={onCommandSelect}
        onClose={vi.fn()}
      />,
      ctx,
    );
    const commandButtons = slashRender.container.querySelectorAll('button');
    expect(commandButtons).toHaveLength(SLASH_COMMANDS.length);
    clickSequence(commandButtons[1] as HTMLButtonElement);
    expect(onCommandSelect).toHaveBeenCalledExactlyOnceWith(SLASH_COMMANDS[1]);
    // A press on the title of the panel keeps the editor focus too
    const insertTitle = Array.from(
      slashRender.container.querySelectorAll('div'),
    ).find(
      (element) =>
        element.childElementCount === 0 && element.textContent === 'Insert',
    );
    if (!insertTitle) throw new Error('Missing group title');
    const titlePress = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    insertTitle.dispatchEvent(titlePress);
    expect(titlePress.defaultPrevented).toBe(true);
    slashRender.unmount();
  });

  it('keeps the editor focus through a drill-down and still closes on the next click outside', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const view = renderInCanvas(
      <FieldMentionDropdown
        fields={[
          {
            apiKey: 'title',
            label: 'Title',
            fieldPath: 'title',
            displayLabel: 'Title',
            fieldType: 'string',
            depth: 0,
            localized: true,
            availableLocales: ['en', 'it'],
            isBlockContainer: false,
          },
        ]}
        query=""
        selectedIndex={0}
        onSelect={onSelect}
        onClose={onClose}
      />,
      createCanvasCtx(),
    );
    const option = view.container.querySelector('button') as HTMLButtonElement;
    const mousedown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      option.dispatchEvent(mousedown);
      option.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(mousedown.defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Title · Locale');
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('renders only a window of a long list, with spacers for the rest', () => {
    const users = Array.from({ length: 300 }, (_, index) => ({
      id: `user-${index}`,
      name: `Person ${index + 1}`,
      email: `person${index}@example.com`,
      avatarUrl: null,
    }));
    const view = renderInCanvas(
      <UserMentionDropdown
        users={users}
        query=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
      createCanvasCtx(),
    );
    const rows = view.container.querySelectorAll('[data-mention-row]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(40);
    // The rows that are not rendered keep their place, hidden from readers
    const spacer = rows[rows.length - 1].nextElementSibling;
    expect(spacer?.getAttribute('aria-hidden')).toBe('true');
    view.unmount();
  });

  it('tells while the collaborators load, and after their load failed', () => {
    const ctx = createCanvasCtx();
    const onRetry = vi.fn();
    const props = {
      users: [],
      query: '',
      selectedIndex: 0,
      onSelect: vi.fn(),
      onClose: vi.fn(),
    };
    const view = renderInCanvas(
      <UserMentionDropdown {...props} isLoading />,
      ctx,
    );
    expect(view.container.textContent).toContain('Loading collaborators…');
    expect(view.container.textContent).not.toContain('No collaborators');

    view.rerender(
      <UserMentionDropdown {...props} loadFailed onRetry={onRetry} />,
    );
    expect(view.container.textContent).toContain(
      "The collaborators didn't load.",
    );
    const retry = findButtonByText(view.container, 'Try again');
    if (!retry) throw new Error('Try again missing');
    const mousedown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      retry.dispatchEvent(mousedown);
      retry.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    // The editor keeps the focus
    expect(mousedown.defaultPrevented).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(1);

    view.rerender(<UserMentionDropdown {...props} />);
    expect(view.container.textContent).toContain('No collaborators');
    view.unmount();
  });
});

type CommentObject = ReturnType<typeof createResolvedCommentWithReplies>;

const PROJECT_USERS = [
  {
    id: 'user-1',
    name: 'User One',
    email: 'user@example.com',
    avatarUrl: null,
  },
];

function renderCommentTree(
  ctx: RenderItemFormSidebarCtx,
  commentObject: CommentObject,
  editComment = vi.fn(() => true),
  readableModels: ModelInfo[] = [],
  onRecordModelSelect?: (model: ModelInfo) => void,
  deleteComment: (commentId: string, parentId?: string) => boolean = vi.fn(
    () => true,
  ),
) {
  return (
    <SidebarNavigationProvider ctx={ctx}>
      <ProjectDataProvider
        projectUsers={PROJECT_USERS}
        projectModels={[]}
        modelFields={[]}
        currentUserId="user-1"
        typedUsers={[{ user: PROJECT_USERS[0], userType: 'user' }]}
      >
        <Comment
          deleteComment={deleteComment}
          editComment={editComment}
          upvoteComment={vi.fn(() => true)}
          replyComment={vi.fn(() => true)}
          commentObject={commentObject}
          currentUserId="user-1"
          projectUsers={PROJECT_USERS}
          projectModels={[]}
          readableModels={readableModels}
          onRecordModelSelect={onRecordModelSelect}
          ctx={ctx}
        />
      </ProjectDataProvider>
    </SidebarNavigationProvider>
  );
}

function getActionsGroup(container: HTMLElement): HTMLElement {
  const group = container.querySelector<HTMLElement>(
    '[role="group"][aria-label="Comment actions"]',
  );
  if (!group) throw new Error('Comment actions missing');
  return group;
}

function mouseDown(element: Element) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
  });
}

// The kit menu opens, and picks an option, on mouse down, as in the CMS
function openActionsMenu(container: HTMLElement) {
  const trigger = getActionsGroup(container).querySelector<HTMLButtonElement>(
    'button[aria-expanded]',
  );
  if (!trigger) throw new Error('Actions menu trigger missing');
  mouseDown(trigger);
}

function findButtonByText(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === text,
  );
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (!setValue) throw new Error('Missing input value setter');
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// The record mention of the toolbar is a menu of the models: its trigger
// tells that it opens one
function findRecordMentionTrigger(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[role="toolbar"] [aria-haspopup="true"]',
    ),
  ).find((trigger) => trigger.textContent === 'Record');
}

function openRecordMentionMenu(container: HTMLElement) {
  const trigger = findRecordMentionTrigger(container);
  if (!trigger) throw new Error('Record mention trigger missing');
  // The kit menu opens on mouse down, as in the CMS
  mouseDown(trigger);
  // The menu renders at the end of the body
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  if (!menu) throw new Error('Model menu missing');
  return { trigger, menu };
}

// The editor scrolls the caret into view when it takes the focus: jsdom has
// no layout for ranges
async function withRangeLayout(run: () => Promise<void>) {
  const rangePrototype = Range.prototype as Partial<Range>;
  const originalRects = rangePrototype.getClientRects;
  const originalRect = rangePrototype.getBoundingClientRect;
  rangePrototype.getClientRects = () =>
    [] as unknown as ReturnType<Range['getClientRects']>;
  rangePrototype.getBoundingClientRect = () => new DOMRect();
  try {
    await run();
  } finally {
    rangePrototype.getClientRects = originalRects;
    rangePrototype.getBoundingClientRect = originalRect;
  }
}

function nextFrame() {
  return act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

const ARTICLE_MODEL: ModelInfo = {
  id: 'model-1',
  apiKey: 'article',
  name: 'Article',
  isBlockModel: false,
};
const PAGE_MODEL: ModelInfo = {
  id: 'model-2',
  apiKey: 'landing_page',
  name: 'Page',
  isBlockModel: false,
};
const HERO_BLOCK: ModelInfo = {
  id: 'block-1',
  apiKey: 'hero',
  name: 'Hero',
  isBlockModel: true,
};

describe('comment accessibility and semantics', () => {
  it('passes the content from editing start after the displayed comment receives an update', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const editComment = vi.fn(() => true);
    const baseline = [{ type: 'text' as const, content: 'Original' }];
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      content: baseline,
      storedContent: baseline,
      author: createResolvedAuthor({ id: 'user-1' }),
    });
    const view = renderInCanvas(
      renderCommentTree(ctx, comment, editComment),
      ctx,
    );

    openActionsMenu(view.container);
    // The menu renders at the end of the body
    const editOption = findButtonByText(document.body, 'Edit');
    if (!editOption) throw new Error('Edit option missing');
    mouseDown(editOption);

    const updated = [
      { type: 'text' as const, content: 'Another user changed this' },
    ];
    view.rerender(
      renderCommentTree(
        ctx,
        { ...comment, content: updated, storedContent: updated },
        editComment,
      ),
    );
    const saveButton = findButtonByText(view.container, 'Save');
    if (!saveButton) throw new Error('Save action missing');
    act(() => saveButton.click());

    expect(editComment).toHaveBeenCalledWith(
      'comment-1',
      baseline,
      undefined,
      baseline,
    );
    view.unmount();
  });

  it('names the editor of an edit through its field, as any input', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
    });
    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);
    openActionsMenu(view.container);
    const editOption = findButtonByText(document.body, 'Edit');
    if (!editOption) throw new Error('Edit option missing');
    mouseDown(editOption);

    const editor =
      view.container.querySelector<HTMLElement>('[role="textbox"]');
    if (!editor) throw new Error('Editor missing');
    const labelId = editor.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId ?? '')?.textContent).toBe(
      'Edit comment',
    );
    // The hidden label of the field points to the editor
    const label = view.container.querySelector('label');
    expect(label?.htmlFor).toBe(editor.id);
    expect(editor.hasAttribute('aria-label')).toBe(false);
    view.unmount();
  });

  function startEditing(
    readableModels: ModelInfo[],
    onRecordModelSelect?: (model: ModelInfo) => void,
  ) {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
    });
    const view = renderInCanvas(
      renderCommentTree(
        ctx,
        comment,
        vi.fn(() => true),
        readableModels,
        onRecordModelSelect,
      ),
      ctx,
    );
    openActionsMenu(view.container);
    const editOption = findButtonByText(document.body, 'Edit');
    if (!editOption) throw new Error('Edit option missing');
    mouseDown(editOption);
    return view;
  }

  it('offers a record mention in an edit only when the user can read a model', () => {
    const withoutModels = startEditing([]);
    expect(
      withoutModels.container.querySelector(
        '[aria-label="Mention a collaborator"]',
      ),
    ).not.toBeNull();
    expect(findRecordMentionTrigger(withoutModels.container)).toBeUndefined();
    withoutModels.unmount();

    // Blocks are never records of their own: they don't count
    const onlyBlocks = startEditing([HERO_BLOCK]);
    expect(findRecordMentionTrigger(onlyBlocks.container)).toBeUndefined();
    onlyBlocks.unmount();

    const withModels = startEditing([ARTICLE_MODEL]);
    expect(findRecordMentionTrigger(withModels.container)).toBeDefined();
    withModels.unmount();
  });

  it('picks the model of a record mention in the menu of the toolbar', () => {
    const onRecordModelSelect = vi.fn();
    const view = startEditing(
      [ARTICLE_MODEL, HERO_BLOCK, PAGE_MODEL],
      onRecordModelSelect,
    );
    const { trigger, menu } = openRecordMentionMenu(view.container);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const optionTexts = () =>
      Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
        (option) => option.textContent,
      );
    expect(menu.textContent).toContain('Pick a model');
    expect(optionTexts()).toEqual(['Articlearticle', 'Pagelanding_page']);

    // The search of the menu finds a model by its name or its API key
    const search = menu.querySelector('input');
    if (!search) throw new Error('Model search missing');
    changeInputValue(search, 'zzz');
    expect(optionTexts()).toEqual([]);
    expect(menu.textContent).toContain('No models match “zzz”');
    changeInputValue(search, 'LANDING');
    expect(optionTexts()).toEqual(['Pagelanding_page']);

    const option = menu.querySelector('[role="menuitem"]');
    if (!option) throw new Error('Model option missing');
    mouseDown(option);
    expect(onRecordModelSelect).toHaveBeenCalledTimes(1);
    expect(onRecordModelSelect.mock.calls[0]?.[0]).toBe(PAGE_MODEL);
    // The pick closes the menu
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    view.unmount();
  });

  it('gives the focus back to the text when Escape closes the model menu', async () => {
    await withRangeLayout(async () => {
      const onRecordModelSelect = vi.fn();
      const view = startEditing([ARTICLE_MODEL], onRecordModelSelect);
      try {
        const { trigger, menu } = openRecordMentionMenu(view.container);
        // The search of the menu has the focus
        const search = menu.querySelector('input');
        if (!search) throw new Error('Model search missing');
        expect(document.activeElement).toBe(search);

        // The kit menu reads the code of the key
        act(() => {
          search.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true,
            }),
          );
        });

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onRecordModelSelect).not.toHaveBeenCalled();
        // The editor takes the focus on the next frame
        await nextFrame();
        expect(document.activeElement).toBe(
          view.container.querySelector('[role="textbox"]'),
        );
      } finally {
        view.unmount();
      }
    });
  });

  it('keeps an empty reply while the user picks the model of a record', async () => {
    await withRangeLayout(async () => {
      const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
        createSidebarFields(),
      );
      const deleteComment = vi.fn(() => true);
      // A reply just started: no text yet
      const draft = createResolvedCommentWithReplies(0, {
        id: 'reply-1',
        parentCommentId: 'comment-1',
        content: [],
        storedContent: [],
        author: createResolvedAuthor({ id: 'user-1' }),
      });
      const view = renderInCanvas(
        renderCommentTree(
          ctx,
          draft,
          vi.fn(() => true),
          [ARTICLE_MODEL],
          vi.fn(),
          deleteComment,
        ),
        ctx,
      );
      try {
        await nextFrame();
        const editor =
          view.container.querySelector<HTMLElement>('[role="textbox"]');
        if (!editor) throw new Error('Reply editor missing');
        act(() => editor.focus());

        // The search of the menu takes the focus from the empty reply
        const { menu } = openRecordMentionMenu(view.container);
        expect(document.activeElement).toBe(menu.querySelector('input'));
        await act(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 300);
            }),
        );
        expect(deleteComment).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    });
  });

  it('exposes comment actions as a labeled group instead of a fake menu', () => {
    const onDelete = vi.fn();
    const view = renderInCanvas(
      <CommentActions
        onUpvote={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onReply={vi.fn()}
        userUpvoted={false}
        userIsAuthor={true}
        isTopLevel={true}
        hasUpvotes={false}
      />,
      createCanvasCtx(),
    );

    const group = getActionsGroup(view.container);
    expect(
      Array.from(group.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Upvote', 'Reply', 'Actions']);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="menuitem"]')).toBeNull();

    // Edit and Delete live in the "⋮" menu, Delete last
    openActionsMenu(view.container);
    const options = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).map((option) => option.textContent);
    expect(options).toEqual(['Edit', 'Delete']);
    view.unmount();
  });

  it('shows only the actions that apply to the comment', () => {
    const view = renderInCanvas(
      <CommentActions
        onUpvote={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        userUpvoted={false}
        userIsAuthor={false}
        isTopLevel={false}
        hasUpvotes={true}
      />,
      createCanvasCtx(),
    );

    // A reply of someone else with upvotes: nothing to do from the header
    expect(view.container.querySelector('[role="group"]')).toBeNull();
    view.unmount();
  });

  it('renders comment icons without standalone SVG title nodes', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(1, {
      id: 'comment-1',
      author: createResolvedAuthor({
        id: 'user-1',
        email: 'user@example.com',
        name: 'User One',
      }),
      upvoters: [
        createResolvedAuthor({
          id: 'user-2',
          email: 'voter@example.com',
          name: 'Voter',
        }),
      ],
      content: [{ type: 'text', content: 'Hello' }],
    });

    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);

    // The reaction names its count, and the toggle its replies
    expect(findButtonByText(view.container, '1 upvote')).toBeDefined();
    expect(findButtonByText(view.container, '1 reply')).toBeDefined();
    expect(view.container.querySelectorAll('svg')).not.toHaveLength(0);
    expect(view.container.querySelectorAll('title')).toHaveLength(0);
    view.unmount();
  });

  it('keeps the replies that the toggle controls in the page while they are closed', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(1, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
    });
    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);

    const toggle = findButtonByText(view.container, '1 reply');
    if (!toggle) throw new Error('Replies toggle missing');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The faces are decorative: the toggle's name is its text
    expect(
      toggle.querySelectorAll('img:not([alt=""]), [role="img"][aria-label]'),
    ).toHaveLength(0);
    const repliesId = toggle.getAttribute('aria-controls');
    if (!repliesId) throw new Error('aria-controls missing');
    const replies = () => document.getElementById(repliesId);
    expect(replies()?.hidden).toBe(true);
    expect(replies()?.querySelector('li')).toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(replies()?.hidden).toBe(false);
    expect(replies()?.querySelectorAll('li')).toHaveLength(1);
    view.unmount();
  });

  it('links a field mention to its field, and scrolls to a localized one', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
      content: [
        {
          type: 'mention',
          mention: {
            type: 'field',
            apiKey: 'title',
            label: 'Title',
            localized: false,
            fieldPath: 'title',
            fieldType: 'string',
          },
        },
        { type: 'text', content: ' and ' },
        {
          type: 'mention',
          mention: {
            type: 'field',
            apiKey: 'body',
            label: 'Body',
            localized: true,
            fieldPath: 'body',
            locale: 'it',
            fieldType: 'text',
          },
        },
      ],
    });
    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);

    // A CMS link: a middle click opens the field in a new tab
    const link = Array.from(view.container.querySelectorAll('a')).find(
      (anchor) => anchor.textContent === '#title',
    );
    if (!link) throw new Error('Field link missing');
    expect(link.getAttribute('href')).toBe(
      'https://example.admin.datocms.com/editor/item_types/model-1/items/record-1/edit#fieldPath=title',
    );
    act(() => link.click());
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/editor/item_types/model-1/items/record-1/edit#fieldPath=title',
    );

    // A localized field also scrolls the form to its locale: an action
    const localized = findButtonByText(view.container, '#body · IT');
    if (!localized) throw new Error('Localized field mention missing');
    act(() => localized.click());
    expect(ctx.scrollToField).toHaveBeenCalledWith('body', 'it');
    view.unmount();
  });

  it('keeps a field mention an action when the project has no internal domain', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>({
      ...createSidebarFields(),
      site: { attributes: { internal_domain: null } },
    });
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
      content: [
        {
          type: 'mention',
          mention: {
            type: 'field',
            apiKey: 'title',
            label: 'Title',
            localized: false,
            fieldPath: 'title',
            fieldType: 'string',
          },
        },
      ],
    });
    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);

    // No link: its URL would point to the plugin, not to the CMS
    expect(view.container.querySelector('a')).toBeNull();
    const mention = findButtonByText(view.container, '#title');
    if (!mention) throw new Error('Field mention missing');
    act(() => mention.click());
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/editor/item_types/model-1/items/record-1/edit#fieldPath=title',
    );
    view.unmount();
  });

  it('opens the users page from a user mention, and keeps the owner static', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
      content: [
        {
          type: 'mention',
          mention: {
            type: 'user',
            id: 'user-1',
            name: 'User One',
            email: 'user@example.com',
            avatarUrl: null,
          },
        },
        { type: 'text', content: ' and ' },
        {
          type: 'mention',
          mention: {
            type: 'user',
            id: 'owner-1',
            name: 'Project Owner',
            email: 'owner@example.com',
            avatarUrl: null,
          },
        },
      ],
    });

    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);

    const userPill = findButtonByText(view.container, '@User One');
    if (!userPill) throw new Error('User mention missing');
    act(() => userPill.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://example.admin.datocms.com/project_settings/users',
      '_blank',
    );

    // The owner has no users page: the pill is a static reference
    expect(findButtonByText(view.container, '@Project Owner')).toBeUndefined();
    expect(view.container.textContent).toContain('@Project Owner');
    view.unmount();
    open.mockRestore();
  });

  it('turns a preview or a thumbnail that fails to load into a plain mention', () => {
    const ctx = createCanvasCtx<RenderItemFormSidebarCtx>(
      createSidebarFields(),
    );
    const comment = createResolvedCommentWithReplies(0, {
      id: 'comment-1',
      author: createResolvedAuthor({ id: 'user-1' }),
      content: [
        {
          type: 'mention',
          mention: {
            type: 'asset',
            id: 'asset-1',
            filename: 'hero.png',
            url: 'https://www.datocms-assets.com/hero.png',
            thumbnailUrl: 'https://www.datocms-assets.com/hero.png?w=300',
            mimeType: 'image/png',
          },
        },
        {
          type: 'mention',
          mention: {
            type: 'record',
            id: 'record-2',
            title: 'Spring launch',
            modelId: 'model-1',
            modelApiKey: 'article',
            modelName: 'Article',
            modelEmoji: null,
            thumbnailUrl: 'https://www.datocms-assets.com/cover.png?w=300',
          },
        },
      ],
    });
    const view = renderInCanvas(renderCommentTree(ctx, comment), ctx);

    // An image shows as a preview tile, named by its file name
    const tile = findButtonByText(view.container, 'hero.png');
    if (!tile) throw new Error('Asset preview missing');
    expect(tile.querySelector('img')).not.toBeNull();
    act(() => tile.click());
    expect(ctx.editUpload).toHaveBeenCalledWith('asset-1');

    const record = findButtonByText(view.container, 'Spring launch');
    if (!record) throw new Error('Record mention missing');
    const thumbnail = record.querySelector('img');
    if (!thumbnail) throw new Error('Record thumbnail missing');

    for (const image of Array.from(view.container.querySelectorAll('img'))) {
      act(() => {
        image.dispatchEvent(new Event('error'));
      });
    }

    // The asset becomes a pill, and the record keeps its pill with an icon
    const assetPill = findButtonByText(view.container, 'hero.png');
    expect(assetPill?.className).toContain('Pill');
    expect(assetPill?.querySelector('img')).toBeNull();
    expect(record.querySelector('img')).toBeNull();
    expect(record.querySelector('svg')).not.toBeNull();
    view.unmount();
  });
});
