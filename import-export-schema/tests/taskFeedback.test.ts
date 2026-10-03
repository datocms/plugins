import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskProgressOverlay } from '@/components/TaskProgressOverlay';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { ImportWorkflow } from '@/entrypoints/ImportPage/ImportWorkflow';
import type { UseLongTaskResult } from '@/shared/tasks/useLongTask';
import type { ProjectSchema } from '@/utils/ProjectSchema';

vi.mock('@/components/ProgressOverlay', () => ({
  ProgressOverlay: ({ title, subtitle }: { title: string; subtitle: string }) =>
    createElement('div', null, title, subtitle),
}));
vi.mock('@/entrypoints/ImportPage/FileDropZone', () => ({
  default: ({ children }: { children: (button: ReactNode) => ReactNode }) =>
    children(null),
}));
vi.mock('datocms-react-ui', () => ({
  Button: ({ children }: { children: ReactNode }) =>
    createElement('button', null, children),
  Spinner: () => createElement('div', null, 'Loading'),
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
          title: 'Import in progress',
          subtitle: (state) =>
            state.cancelRequested ? 'Cancelling safely' : 'Applying schema',
          ariaLabel: 'Import',
        }),
      );
      expect(output).toContain('Import in progress');
      expect(output).toContain(
        status === 'cancelling' ? 'Cancelling safely' : 'Applying schema',
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
