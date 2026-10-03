// @vitest-environment jsdom

import Comment from '@components/Comment';
import ModelMentionDropdown from '@components/ModelMentionDropdown';
import type { ResolvedCommentType } from '@ctypes/comments';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigationProvider } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { ProjectDataProvider } from '@/entrypoints/contexts/ProjectDataContext';
import { createResolvedCommentWithReplies } from '../fixtures/comments';
import { render } from '../testUtils/react';

TimeAgo.addDefaultLocale(en);

function renderThread(comment: ResolvedCommentType) {
  const ctx = {
    site: { attributes: { internal_domain: 'example.admin.datocms.com' } },
    itemType: { id: 'model-1' },
    item: { id: 'record-1' },
    locale: 'en',
  } as never;
  return (
    <SidebarNavigationProvider ctx={ctx}>
      <ProjectDataProvider
        projectUsers={[]}
        projectModels={[]}
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
          projectUsers={[]}
          projectModels={[]}
          ctx={ctx}
        />
      </ProjectDataProvider>
    </SidebarNavigationProvider>
  );
}

function findButton(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

describe('large sidebar lists', () => {
  it('windows a large model dropdown without losing keyboard or mouse selection', () => {
    const models = Array.from({ length: 10000 }, (_, index) => ({
      id: `model-${index}`,
      apiKey: `model_${index}`,
      name: `Model ${index}`,
      isBlockModel: false,
    }));
    const onSelect = vi.fn();
    const props = { models, query: '', onSelect, onClose: vi.fn() };
    const view = render(<ModelMentionDropdown {...props} selectedIndex={0} />);
    expect(view.container.querySelectorAll('button')).toHaveLength(40);
    view.rerender(<ModelMentionDropdown {...props} selectedIndex={9999} />);
    expect(view.container.querySelectorAll('button')).toHaveLength(40);
    const last = findButton(view.container, 'Model 9999');
    act(() =>
      last.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      ),
    );
    expect(onSelect).toHaveBeenCalledWith(models[9999]);
    const list =
      view.container.querySelector('[data-mention-row]')?.parentElement;
    if (!list) throw new Error('Missing list');
    act(() => {
      list.scrollTop = 2000 * 40;
      list.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(view.container.querySelectorAll('button')).toHaveLength(40);
    expect(findButton(view.container, 'Model 2000')).toBeTruthy();
    view.unmount();
  });

  it('keeps small dropdowns unchanged', () => {
    const models = Array.from({ length: 20 }, (_, index) => ({
      id: `model-${index}`,
      apiKey: `model_${index}`,
      name: `Model ${index}`,
      isBlockModel: false,
    }));
    const view = render(
      <ModelMentionDropdown
        models={models}
        query=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(view.container.querySelectorAll('button')).toHaveLength(20);
    expect(
      view.container.querySelectorAll('[aria-hidden="true"]'),
    ).toHaveLength(0);
    view.unmount();
  });

  it('renders large reply threads in groups while retaining newly added replies', () => {
    const comment = createResolvedCommentWithReplies(600, {
      id: 'parent',
      content: [{ type: 'text', content: 'Parent' }],
    });
    const view = render(renderThread(comment));
    act(() => findButton(view.container, '600 replies').click());
    expect(view.container.querySelector('[data-comment-id="parent-reply-1"]')).not.toBeNull();
    expect(view.container.querySelector('[data-comment-id="parent-reply-101"]')).toBeNull();
    act(() => findButton(view.container, 'Load more replies').click());
    expect(view.container.querySelector('[data-comment-id="parent-reply-200"]')).not.toBeNull();
    expect(view.container.querySelector('[data-comment-id="parent-reply-201"]')).toBeNull();
    const newReply = {
      ...comment.replies?.[599],
      id: 'new-reply',
      content: [{ type: 'text' as const, content: 'Newest reply' }],
    } as ResolvedCommentType;
    view.rerender(
      renderThread({
        ...comment,
        replies: [...(comment.replies ?? []), newReply],
      }),
    );
    expect(view.container.querySelector('[data-comment-id="parent-reply-200"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Newest reply');
    view.unmount();
  });

  it('shows a newly persisted reply after remount and loads the remaining replies in stored order', () => {
    const comment = createResolvedCommentWithReplies(130, {
      id: 'parent',
      content: [{ type: 'text', content: 'Parent' }],
    });
    const previousView = render(renderThread(comment));
    act(() => findButton(previousView.container, '130 replies').click());
    previousView.unmount();
    const originalReply = comment.replies?.[0];
    if (!originalReply) throw new Error('Missing original reply');
    const savedReply: ResolvedCommentType = {
      ...originalReply,
      id: 'newest-saved',
      content: [{ type: 'text', content: 'Olá العربية 🌍\nsegunda linha' }],
    };
    const replies = [savedReply, ...(comment.replies ?? [])];
    const view = render(renderThread({ ...comment, replies }));
    act(() => findButton(view.container, '131 replies').click());
    const renderedIds = () =>
      [...view.container.querySelectorAll('[data-comment-id]')].map((element) =>
        element.getAttribute('data-comment-id'),
      );
    expect(renderedIds()).toEqual([
      comment.id,
      ...replies.slice(0, 100).map((reply) => reply.id),
    ]);
    expect(view.container.textContent).toContain('Olá العربية 🌍');
    expect(view.container.textContent).toContain('segunda linha');
    expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
    act(() => findButton(view.container, 'Load more replies').click());
    expect(renderedIds()).toEqual([comment.id, ...replies.map((reply) => reply.id)]);
    expect(new Set(renderedIds()).size).toBe(132);
    expect(view.container.textContent).not.toContain('Load more replies');
    view.unmount();
  });

  it('keeps a prepended reply draft and its saved content visible above a paginated thread', () => {
    const comment = createResolvedCommentWithReplies(130, {
      id: 'parent',
      content: [{ type: 'text', content: 'Parent' }],
    });
    const view = render(renderThread(comment));
    act(() => findButton(view.container, '130 replies').click());
    expect(view.container.querySelectorAll('[data-comment-id]')).toHaveLength(101);
    const originalReply = comment.replies?.[0];
    if (!originalReply) throw new Error('Missing original reply');
    const draft: ResolvedCommentType = {
      ...originalReply,
      id: 'prepended-draft',
      content: [],
      author: { ...originalReply.author, id: 'user-1' },
    };
    view.rerender(renderThread({
      ...comment,
      replies: [draft, ...(comment.replies ?? [])],
    }));
    expect(
      view.container.querySelector('[data-comment-id="prepended-draft"] [contenteditable="true"]'),
    ).not.toBeNull();
    expect(view.container.querySelectorAll('[data-comment-id]')).toHaveLength(102);
    const saved: ResolvedCommentType = {
      ...draft,
      content: [{ type: 'text', content: 'Saved prepended reply' }],
    };
    view.rerender(renderThread({
      ...comment,
      replies: [saved, ...(comment.replies ?? [])],
    }));
    const editor = view.container.querySelector(
      '[data-comment-id="prepended-draft"] [contenteditable="true"]',
    );
    if (!editor) throw new Error('Missing reply editor');
    act(() => editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ));
    expect(view.container.textContent).toContain('Saved prepended reply');
    expect(view.container.querySelectorAll('[data-comment-id]')).toHaveLength(102);
    act(() => findButton(view.container, 'Load more replies').click());
    expect(view.container.querySelectorAll('[data-comment-id]')).toHaveLength(132);
    view.unmount();
  });
});
