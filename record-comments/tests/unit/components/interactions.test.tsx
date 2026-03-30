// @vitest-environment jsdom
import { createRef } from 'react';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { describe, expect, it, vi } from 'vitest';
import UserMentionDropdown from '@components/UserMentionDropdown';
import ModelMentionDropdown from '@components/ModelMentionDropdown';
import { FieldListView } from '@components/field-dropdown/FieldListView';
import { LocalePickerView } from '@components/field-dropdown/LocalePickerView';
import { NestedFieldsView } from '@components/field-dropdown/NestedFieldsView';
import { BlockPickerView } from '@components/field-dropdown/BlockPickerView';
import CommentActions from '@components/CommentActions';
import Comment from '@components/Comment';
import { SidebarNavigationProvider } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { ProjectDataProvider } from '@/entrypoints/contexts/ProjectDataContext';
import { render } from '../testUtils/react';
import {
  createResolvedAuthor,
  createResolvedCommentWithReplies,
} from '../fixtures/comments';

TimeAgo.addDefaultLocale(en);

function clickSequence(button: HTMLButtonElement) {
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function createSidebarCtx() {
  return {
    site: { attributes: { internal_domain: 'example.admin.datocms.com' } },
    itemType: { id: 'model-1' },
    item: { id: 'record-1' },
    locale: 'en',
    editUpload: vi.fn(),
    navigateTo: vi.fn(),
    editItem: vi.fn(),
    scrollToField: vi.fn(),
  } as never;
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

    const userRender = render(
      <UserMentionDropdown
        users={[{ id: 'user-1', name: 'John Doe', email: 'john@example.com', avatarUrl: null }]}
        query=""
        selectedIndex={0}
        onSelect={onUserSelect}
        onClose={vi.fn()}
      />
    );
    clickSequence(userRender.container.querySelector('button') as HTMLButtonElement);
    expect(onUserSelect).toHaveBeenCalledTimes(1);
    userRender.unmount();

    const modelRender = render(
      <ModelMentionDropdown
        models={[{ id: 'model-1', apiKey: 'article', name: 'Article', isBlockModel: false }]}
        query=""
        selectedIndex={0}
        onSelect={onModelSelect}
        onClose={vi.fn()}
      />
    );
    clickSequence(modelRender.container.querySelector('button') as HTMLButtonElement);
    expect(onModelSelect).toHaveBeenCalledTimes(1);
    modelRender.unmount();

    const fieldRender = render(
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
      />
    );
    clickSequence(fieldRender.container.querySelector('button') as HTMLButtonElement);
    expect(onFieldSelect).toHaveBeenCalledTimes(1);
    fieldRender.unmount();

    const localeRender = render(
      <LocalePickerView
        locales={['en']}
        selectedIndex={0}
        onSelect={onLocaleSelect}
        onHover={vi.fn()}
        selectedRef={createRef()}
        justClickedInsideRef={justClickedInsideRef}
      />
    );
    clickSequence(localeRender.container.querySelector('button') as HTMLButtonElement);
    expect(onLocaleSelect).toHaveBeenCalledTimes(1);
    localeRender.unmount();

    const nestedRender = render(
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
      />
    );
    clickSequence(nestedRender.container.querySelector('button') as HTMLButtonElement);
    expect(onNestedFieldSelect).toHaveBeenCalledTimes(1);
    nestedRender.unmount();

    const blockRender = render(
      <BlockPickerView
        blocks={[{ index: 0, modelId: 'block-1', modelName: 'Hero Block' }]}
        selectedIndex={1}
        isLoading={false}
        onSelectEntireField={onSelectEntireField}
        onSelectBlock={onBlockSelect}
        onHover={vi.fn()}
        selectedRef={createRef()}
        justClickedInsideRef={justClickedInsideRef}
      />
    );
    const buttons = blockRender.container.querySelectorAll('button');
    clickSequence(buttons[0] as HTMLButtonElement);
    clickSequence(buttons[1] as HTMLButtonElement);
    expect(onSelectEntireField).toHaveBeenCalledTimes(1);
    expect(onBlockSelect).toHaveBeenCalledTimes(1);
    blockRender.unmount();
  });
});

describe('comment accessibility and semantics', () => {
  it('exposes comment actions as a labeled group instead of a fake menu', () => {
    const view = render(
      <CommentActions
        onUpvote={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onReply={vi.fn()}
        userUpvoted={false}
        userIsAuthor={true}
        isTopLevel={true}
        hasUpvotes={false}
      />
    );

    expect(view.container.querySelector('[role="menu"]')).toBeNull();
    expect(view.container.querySelector('[role="menuitem"]')).toBeNull();
    expect(view.container.querySelector('[role="group"]')).not.toBeNull();
    view.unmount();
  });

  it('renders comment icons without standalone SVG title nodes', () => {
    const ctx = createSidebarCtx();
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

    const view = render(
      <SidebarNavigationProvider ctx={ctx}>
        <ProjectDataProvider
          projectUsers={[
            { id: 'user-1', name: 'User One', email: 'user@example.com', avatarUrl: null },
          ]}
          projectModels={[
            { id: 'model-1', apiKey: 'article', name: 'Article', isBlockModel: false },
          ]}
          modelFields={[]}
          currentUserId="user-1"
          typedUsers={[]}
        >
          <Comment
            deleteComment={vi.fn(() => true)}
            editComment={vi.fn(() => true)}
            upvoteComment={vi.fn(() => true)}
            replyComment={vi.fn(() => true)}
            commentObject={comment}
            currentUserId="user-1"
            projectUsers={[
              { id: 'user-1', name: 'User One', email: 'user@example.com', avatarUrl: null },
            ]}
            projectModels={[
              { id: 'model-1', apiKey: 'article', name: 'Article', isBlockModel: false },
            ]}
            ctx={ctx}
          />
        </ProjectDataProvider>
      </SidebarNavigationProvider>
    );

    expect(view.container.querySelectorAll('title')).toHaveLength(0);
    view.unmount();
  });
});
