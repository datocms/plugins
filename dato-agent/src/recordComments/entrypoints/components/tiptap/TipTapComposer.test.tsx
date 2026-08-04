import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavigationCallbacksProvider } from '../../contexts/NavigationCallbacksContext';
import { TipTapComposer } from './TipTapComposer';

const mockEditor = vi.hoisted(() => ({
  getJSON: vi.fn(() => ({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })),
  setEditable: vi.fn(),
  get view(): never {
    throw new Error(
      "[tiptap error]: The editor view is not available. Cannot access view['dom']. The editor may not be mounted yet.",
    );
  },
}));

vi.mock('@tiptap/react', async () => {
  const actual =
    await vi.importActual<typeof import('@tiptap/react')>('@tiptap/react');

  return {
    ...actual,
    EditorContent: () => <div />,
    useEditor: () => mockEditor,
  };
});

describe('TipTapComposer mount lifecycle', () => {
  it('synchronizes its disabled state without reading an unmounted editor view', () => {
    expect(() => {
      render(
        <NavigationCallbacksProvider
          callbacks={{
            handleOpenAsset: vi.fn(),
            handleOpenFile: vi.fn(),
            handleOpenRecord: vi.fn(),
          }}
        >
          <TipTapComposer
            disabled
            projectModels={[]}
            projectUsers={[]}
            segments={[]}
          />
        </NavigationCallbacksProvider>,
      );
    }).not.toThrow();

    expect(mockEditor.setEditable).toHaveBeenCalledWith(false, false);
  });
});
