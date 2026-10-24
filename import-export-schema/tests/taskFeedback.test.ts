import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskProgressOverlay } from '@/components/TaskProgressOverlay';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { ImportWorkflow } from '@/entrypoints/ImportPage/ImportWorkflow';
import type { UseLongTaskResult } from '@/shared/tasks/useLongTask';
import type { ProjectSchema } from '@/utils/ProjectSchema';

// The components of datocms-react-ui need a Canvas: the modules under test
// get stubs that render their texts and children as plain text.
const reactUi = vi.hoisted(() => ({
  async stub(parts: string[] = []) {
    const { createElement, Fragment } = await import('react');
    type StubProps = Record<string, unknown> & { children?: ReactNode };
    type Stub = ((props: StubProps) => ReactNode) & { [part: string]: Stub };
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    const make = (): Stub => {
      const component = (props: StubProps) =>
        createElement(
          Fragment,
          {},
          // A loading state says so, thus a test can tell it from the others
          props.loading ? 'Loading' : null,
          text(props.title),
          text(props.label),
          text(props.description),
          text(props.caption),
          text(props.code),
          props.actions as ReactNode,
          props.children,
        );
      return Object.assign(component, {} as Record<string, Stub>);
    };
    const root = make();
    for (const part of parts) {
      root[part] = make();
    }
    return { default: root };
  },
}));

vi.mock('datocms-react-ui/BlankSlate', () => reactUi.stub());
vi.mock('datocms-react-ui/Button', () => reactUi.stub());
vi.mock('datocms-react-ui/Callout', () => reactUi.stub());
vi.mock('datocms-react-ui/Main', () => reactUi.stub());
vi.mock('datocms-react-ui/Modal', () => reactUi.stub(['Body', 'Footer']));
vi.mock('datocms-react-ui/ProgressBar', () => reactUi.stub());
vi.mock('datocms-react-ui/Spinner', () => reactUi.stub());
vi.mock('datocms-react-ui/Canvas', () => ({
  useCtx: () => ({ ui: { locale: 'en' } }),
}));
// The drop target and the picker do nothing outside a browser
vi.mock('datocms-react-ui/dnd', async () => {
  const { createElement } = await import('react');
  return {
    dropTargetClassName: () => '',
    useFileDropTarget: () => ({ ref: () => {}, isOver: false }),
    useFilePicker: () => ({
      open: () => {},
      input: createElement('input', { type: 'file', hidden: true }),
    }),
  };
});

// The review screen is not under test here: its stubs keep its imports out
// of this file.
vi.mock('@/entrypoints/ImportPage/Inner', () => ({ Inner: () => null }));
vi.mock('@/entrypoints/ImportPage/ResolutionsForm', () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

describe('long task feedback', () => {
  it.each(['running', 'cancelling'] as const)(
    'keeps blocking progress visible while %s',
    (status) => {
      const task = {
        state: {
          status,
          cancelRequested: status === 'cancelling',
          progress: { done: 10, total: 100 },
        },
      } as UseLongTaskResult;
      const output = renderToStaticMarkup(
        createElement(TaskProgressOverlay, {
          task,
          title: 'Importing the schema',
          subtitle: (state) =>
            state.cancelRequested ? 'Stopping the import…' : 'Applying schema',
          ariaLabel: 'Import',
        }),
      );
      expect(output).toContain('Importing the schema');
      expect(output).toContain(
        status === 'cancelling' ? 'Stopping the import…' : 'Applying schema',
      );
    },
  );

  it('shows a recoverable conflict error instead of an endless spinner', () => {
    const output = renderToStaticMarkup(
      createElement(ImportWorkflow, {
        ctx: {} as RenderPageCtx,
        projectSchema: {} as ProjectSchema,
        exportSchema: ['schema.json', {} as ExportSchema],
        loadingRecipe: false,
        conflicts: undefined,
        conflictsError: new Error('Permission denied'),
        onRetryConflicts: vi.fn(),
        onDrop: vi.fn(),
        onImport: vi.fn(),
      }),
    );
    expect(output).toContain('Permission denied');
    expect(output).toContain('Try again');
    expect(output).not.toContain('Loading');
  });
});
