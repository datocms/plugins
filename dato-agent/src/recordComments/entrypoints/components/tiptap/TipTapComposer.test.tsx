import type { UseEditorOptions } from '@tiptap/react';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../../../../test/canvas';
import { NavigationCallbacksProvider } from '../../contexts/NavigationCallbacksContext';
import { TipTapComposer } from './TipTapComposer';

const mockEditor = vi.hoisted(() => ({
  options: undefined as UseEditorOptions | undefined,
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
    useEditor: (options: UseEditorOptions) => {
      mockEditor.options = options;
      return mockEditor;
    },
  };
});

function withNavigation(children: ReactNode) {
  return (
    <NavigationCallbacksProvider
      callbacks={{
        handleOpenAsset: vi.fn(),
        handleOpenFile: vi.fn(),
        handleOpenRecord: vi.fn(),
      }}
    >
      {children}
    </NavigationCallbacksProvider>
  );
}

function editorAttributes() {
  const attributes = mockEditor.options?.editorProps?.attributes;
  return typeof attributes === 'function' ? undefined : attributes;
}

describe('TipTapComposer mount lifecycle', () => {
  it('synchronizes its disabled state without reading an unmounted editor view', () => {
    expect(() => {
      renderInCanvas(
        withNavigation(
          <TipTapComposer
            disabled
            projectModels={[]}
            projectUsers={[]}
            segments={[]}
          />,
        ),
      );
    }).not.toThrow();

    expect(mockEditor.setEditable).toHaveBeenCalledWith(false, false);
  });

  it('takes the description and the invalid state of its field, and keeps its own name', () => {
    const { getByRole } = renderInCanvas(
      withNavigation(
        <FieldWrapper
          label="Message"
          labelExtras={{ hidden: true }}
          error="This message is too long."
        >
          <TipTapComposer
            ariaLabel="Message the DatoCMS agent"
            projectModels={[]}
            projectUsers={[]}
            segments={[]}
          />
        </FieldWrapper>,
      ),
    );

    const error = getByRole('alert');
    expect(editorAttributes()).toMatchObject({
      'aria-describedby': error.id,
      'aria-invalid': 'true',
      'aria-label': 'Message the DatoCMS agent',
      role: 'textbox',
    });
    expect(editorAttributes()).not.toHaveProperty('aria-labelledby');
  });

  it('adds no field attributes out of a field', () => {
    renderInCanvas(
      withNavigation(
        <TipTapComposer projectModels={[]} projectUsers={[]} segments={[]} />,
      ),
    );

    expect(editorAttributes()).not.toHaveProperty('aria-describedby');
    expect(editorAttributes()).not.toHaveProperty('aria-invalid');
    expect(editorAttributes()).not.toHaveProperty('id');
  });
});
