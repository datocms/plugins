import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDataProvider } from '@/entrypoints/contexts/ProjectDataContext';
import { renderInCanvas } from '../../../../test/canvas';
import { MentionClickContext } from './MentionClickContext';
import { FileMentionNodeView, RecordMentionNodeView } from './MentionNodeView';

afterEach(cleanup);

const fileAttrs = {
  id: 'local-file-1',
  filename: 'research-notes.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  lastModified: 1_786_000_000_000,
};

const recordAttrs = {
  id: 'record-1',
  title: 'Homepage',
  modelId: 'page-model',
  modelApiKey: 'page',
  modelName: 'Page',
  modelEmoji: null,
  thumbnailUrl: null,
};

function renderNodeView(
  View: ComponentType<ReactNodeViewProps>,
  attrs: Record<string, unknown>,
  { currentRecordId, editable = true, composerEditable } = {} as {
    currentRecordId?: string;
    /** What the editor says */
    editable?: boolean;
    /** What the composer tells the node views, when it tells it */
    composerEditable?: boolean;
  },
) {
  const deleteNode = vi.fn();
  const onMentionClick = vi.fn();
  const props = {
    deleteNode,
    editor: { isEditable: editable },
    node: { attrs },
  } as unknown as ReactNodeViewProps;

  renderInCanvas(
    <ProjectDataProvider
      currentRecordId={currentRecordId}
      currentUserId="user-1"
      modelFields={[]}
      projectModels={[]}
      projectUsers={[]}
    >
      <MentionClickContext.Provider
        value={{ onMentionClick, editable: composerEditable }}
      >
        <View {...props} />
      </MentionClickContext.Provider>
    </ProjectDataProvider>,
  );

  return { deleteNode, onMentionClick };
}

describe('MentionNodeView', () => {
  it('opens a reference from a chip that is not a tab stop', () => {
    const { onMentionClick } = renderNodeView(FileMentionNodeView, fileAttrs);
    const chip = screen.getByRole('button', { name: 'research….pdf' });

    expect(chip).toHaveAttribute('tabindex', '-1');
    expect(chip.closest('[contenteditable="false"]')).toBeInTheDocument();

    fireEvent.click(chip);
    expect(onMentionClick).toHaveBeenCalledWith(
      { type: 'file', ...fileAttrs },
      expect.anything(),
    );
  });

  it('clears an attached file from the draft without moving the caret', () => {
    const { deleteNode } = renderNodeView(FileMentionNodeView, fileAttrs);
    const remove = screen.getByRole('button', {
      name: 'Remove research-notes.pdf',
    });

    // A prevented mouse down keeps the editor's selection where it is
    expect(fireEvent.mouseDown(remove)).toBe(false);
    fireEvent.click(remove);
    expect(deleteNode).toHaveBeenCalledOnce();
  });

  it('has no remove control while the editor is read-only', () => {
    renderNodeView(FileMentionNodeView, fileAttrs, { editable: false });

    expect(
      screen.queryByRole('button', { name: 'Remove research-notes.pdf' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'research….pdf' }),
    ).toBeInTheDocument();
  });

  it('follows the composer when it turns the editor off', () => {
    renderNodeView(FileMentionNodeView, fileAttrs, {
      composerEditable: false,
    });

    expect(
      screen.queryByRole('button', { name: 'Remove research-notes.pdf' }),
    ).not.toBeInTheDocument();
  });

  it('has no remove control for other references', () => {
    renderNodeView(RecordMentionNodeView, recordAttrs);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Homepage' })).toBeVisible();
  });

  it('keeps the current record inert', () => {
    const { onMentionClick } = renderNodeView(
      RecordMentionNodeView,
      recordAttrs,
      { currentRecordId: 'record-1' },
    );
    const chip = screen.getByRole('button', { name: 'Homepage' });

    expect(chip).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(chip);
    expect(onMentionClick).not.toHaveBeenCalled();
  });

  it('shows a quiet fallback for a node with invalid attributes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderNodeView(RecordMentionNodeView, { id: 'record-1' });

    expect(screen.getByText('Invalid reference')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
