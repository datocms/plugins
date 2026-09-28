import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { type ReactNode, useState } from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { pageContext } from '../test/fixtures';
import type { LinkGroup, ScanReport } from '../types';
import { ReportLayout } from './ReportLayout';
import { TextDropdown } from './TextDropdown';

// No `vi.mock('datocms-react-ui')` here: these tests cover what the fixture mocks
// can't reproduce. jsdom lacks the observers and matchMedia the kit relies on, and
// the kit uses ResizeObserver as it loads, so the stubs go in before the imports.
const media = vi.hoisted(() => {
  class NoopObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = () => [];
  }
  const matches: Record<string, boolean> = {};
  vi.stubGlobal('ResizeObserver', NoopObserver);
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  return matches;
});

afterEach(() => {
  for (const query of Object.keys(media)) delete media[query];
});

afterAll(() => vi.unstubAllGlobals());

function KitCanvas({ children }: { children: ReactNode }) {
  const ctx = {
    ...pageContext(),
    bodyPadding: [0, 0, 0, 0],
    theme: {},
    cssDesignTokens: {},
  } as unknown as RenderPageCtx;
  return (
    <Canvas ctx={ctx} noAutoResizer>
      {children}
    </Canvas>
  );
}

function brokenGroup(index: number): LinkGroup {
  const url = `https://broken-${index}.example/path`;
  return {
    key: url,
    prepared: { key: url, url, status: 'queued', message: 'Prepared' },
    result: { key: url, url, status: 'broken', message: '', httpStatus: 404 },
    occurrences: [
      {
        id: `occurrence-${index}`,
        recordId: `record-${index}`,
        recordTitle: `Record ${index}`,
        modelId: 'page',
        modelName: 'Page',
        fieldPath: 'url',
        fieldLabel: 'Website',
        locale: 'en',
        blockPath: [],
        url,
      },
    ],
    stale: false,
  };
}

const REPORT: ScanReport = {
  groups: Array.from({ length: 5 }, (_, index) => brokenGroup(index + 1)),
  state: 'complete',
  recordsScanned: 5,
  discovering: false,
  warnings: [],
  scope: 'All models • All locales',
  startedAt: '2026-09-23T12:00:00Z',
  finishedAt: '2026-09-23T12:01:00Z',
};

function Layout() {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <ReportLayout
      report={REPORT}
      scanning={false}
      rechecking={false}
      changedRecordIds={new Set()}
      multiLocale
      uiLocale="en"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      onScan={vi.fn()}
      onChooseScope={vi.fn()}
      onCancel={vi.fn()}
      onExport={vi.fn()}
      onRecheck={vi.fn()}
      onOpenRecord={vi.fn()}
    />
  );
}

describe('with the real datocms-react-ui', () => {
  it('picks the highlighted filter option on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((value) => ({
      value,
      label: `Option ${value.toUpperCase()}`,
    }));
    render(
      <KitCanvas>
        <TextDropdown
          name="Status"
          value="a"
          options={options}
          onChange={onChange}
          uiLocale="en"
        />
      </KitCanvas>,
    );

    await user.click(screen.getByRole('button', { name: 'Status: Option A' }));
    // More than 5 options: the menu has a search field that takes the keys.
    await user.click(screen.getByPlaceholderText('Search...'));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
  });

  it('picks the focused filter option on Enter, whatever is highlighted', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((value) => ({
      value,
      label: `Option ${value.toUpperCase()}`,
    }));
    render(
      <KitCanvas>
        <TextDropdown
          name="Status"
          value="b"
          options={options}
          onChange={onChange}
          uiLocale="en"
        />
      </KitCanvas>,
    );

    await user.click(screen.getByRole('button', { name: 'Status: Option B' }));
    await user.click(screen.getByPlaceholderText('Search...'));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Option A' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('keeps the report mounted while the Info overlay opens and closes', async () => {
    const user = userEvent.setup();
    media['(max-width: 999px)'] = true;
    render(
      <KitCanvas>
        <Layout />
      </KitCanvas>,
    );
    const results = screen.getByRole('table', { name: 'Link check results' });
    const row = within(results)
      .getByText(REPORT.groups[2].prepared.url)
      .closest('tr');
    if (!row) throw new Error('No row');

    await user.click(within(row).getByText(REPORT.groups[2].prepared.url));
    const aside = screen.getByRole('complementary', { name: 'Link details' });
    expect(aside.closest('.blc-overlay')).not.toBeNull();
    expect(aside).toHaveFocus();
    expect(results.isConnected).toBe(true);
    expect(row.isConnected).toBe(true);

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Link check results' })).toBe(
      results,
    );
    expect(row).toHaveFocus();
  });
});
