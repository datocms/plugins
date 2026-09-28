import {
  type ContentAreaSidebarItemsCtx,
  connect,
  type ItemFormSidebarPanelsCtx,
  type ItemType,
} from 'datocms-plugin-sdk';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sdkModel } from './test/fixtures';

vi.mock('datocms-plugin-sdk', () => ({ connect: vi.fn() }));
vi.mock(
  'datocms-react-ui',
  async () => (await import('./test/fixtures')).reactUi,
);
vi.mock('./utils/render', () => ({ render: vi.fn() }));

type Hooks = NonNullable<Parameters<typeof connect>[0]>;
let hooks: Hooks;

beforeAll(async () => {
  await import('./main');
  [hooks] = vi.mocked(connect).mock.calls[0] as [Hooks];
});

function sidebarItems(permissions: string[]) {
  return hooks.contentAreaSidebarItems?.({
    plugin: { attributes: { permissions } },
  } as unknown as ContentAreaSidebarItemsCtx);
}

function panelHeight(locales: string[]) {
  const [panel] =
    hooks.itemFormSidebarPanels?.(
      sdkModel() as ItemType,
      {
        site: { attributes: { locales } },
      } as unknown as ItemFormSidebarPanelsCtx,
    ) ?? [];
  return panel?.initialHeight;
}

describe('plugin hooks', () => {
  it('lists the Link checker page only with the current-user API permission', () => {
    expect(sidebarItems(['currentUserAccessToken'])).toEqual([
      expect.objectContaining({
        label: 'Link checker',
        pointsTo: { pageId: 'link-checker' },
      }),
    ]);
    expect(sidebarItems([])).toEqual([]);
  });

  it('opens the record panel at the idle panel height', () => {
    expect(panelHeight(['en', 'it'])).toBe(41);
    expect(panelHeight(['en'])).toBe(41);
  });
});
