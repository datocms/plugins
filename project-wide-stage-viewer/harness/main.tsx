import 'datocms-react-ui/styles.css';
import '../src/kit-fixes.css';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { createRoot } from 'react-dom/client';
import ConfigScreen from '../src/entrypoints/ConfigScreen';
import StagePage from '../src/entrypoints/StagePage';
import { readMenuItems } from '../src/lib/parameters';
import { FIELDS, ITEM_TYPES } from './data';
import tokensCss from './datocms-tokens.css?raw';
import { resolveDesignTokens } from './tokens';

const params = new URLSearchParams(location.search);
const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
const surface = params.get('surface') === 'config' ? 'config' : 'page';
const canEditSchema = params.get('role') !== 'editor';
const cssDesignTokens = resolveDesignTokens(tokensCss, scheme);

document.documentElement.dataset.colorScheme = scheme;
document.documentElement.style.colorScheme = scheme;
document.body.style.margin = '0';

let parameters: Record<string, unknown> = {
  menuItems: [
    {
      workflowId: 'wf-editorial',
      workflowName: 'Editorial',
      stageId: 'review',
      stageName: 'In review',
    },
    {
      workflowId: 'wf-editorial',
      workflowName: 'Editorial',
      stageId: 'legal',
      stageName: 'Legal check',
      label: 'Waiting on legal',
      icon: 'hand',
    },
  ],
};

const log = async (...args: unknown[]) => console.log('[ctx]', ...args);

// Like the SDK's auto-resizer: the frame grows to the lowest element, open menus included.
function updateFrameHeight() {
  const frame = window.frameElement as HTMLElement | null;
  if (!frame) return;
  let bottom = document.documentElement.scrollHeight;
  for (const element of document.querySelectorAll('body *')) {
    bottom = Math.max(bottom, element.getBoundingClientRect().bottom);
  }
  frame.style.height = `${Math.ceil(bottom)}px`;
}

// Shows what a toast would say, since the harness has no host to draw it.
function toast(kind: string, message: string) {
  console.log(`[${kind}]`, message);
  const host = window.parent.document.body;
  const node = window.parent.document.createElement('div');
  node.textContent = message;
  node.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:9;max-width:420px;padding:12px 16px;border-radius:4px;font:14px sans-serif;color:#fff;background:' +
    (kind === 'alert' ? '#b42318' : '#067647');
  host.append(node);
  setTimeout(() => node.remove(), 4000);
}

function baseCtx() {
  return {
    cssDesignTokens,
    colorScheme: scheme,
    theme: {},
    environment: 'main',
    isEnvironmentPrimary: true,
    cmaBaseUrl: 'https://site-api.datocms.com',
    currentUserAccessToken: 'token',
    currentUser: { id: 'user-1', type: 'user' },
    users: {},
    ssoUsers: {},
    owner: { id: 'owner-1', type: 'account' },
    currentRole: {
      id: 'role-1',
      meta: {
        final_permissions: {
          can_edit_schema: canEditSchema,
          positive_item_type_permissions: [
            { action: 'all', environment: 'main', on_creator: 'anyone' },
          ],
          negative_item_type_permissions: [],
        },
      },
    },
    plugin: {
      id: 'plugin-1',
      type: 'plugin',
      attributes: { name: 'Workflow Stage View', parameters },
    },
    site: {
      id: 'site-1',
      attributes: { locales: ['en', 'it'], timezone: 'Europe/Rome' },
    },
    ui: { locale: 'en-GB' },
    itemTypes: Object.fromEntries(ITEM_TYPES.map((it) => [it.id, it])),
    loadItemTypeFields: async (id: string) => FIELDS[id] ?? [],
    notice: async (message: string) => toast('notice', message),
    alert: async (message: string) => toast('alert', message),
    navigateTo: log,
    // Confirms say yes, and the stage picker takes the first stage offered.
    openConfirm: async (options: { choices: { value: unknown }[] }) =>
      options.choices[0]?.value,
    openModal: async (modal: { parameters: { stages: { id: string }[] } }) =>
      modal.parameters.stages[0]?.id ?? null,
  };
}

const root = createRoot(document.getElementById('root') as HTMLElement);

function render() {
  if (surface === 'config') {
    let observer: MutationObserver | null = null;
    const ctx = {
      ...baseCtx(),
      mode: 'renderConfigScreen',
      bodyPadding: [30, 30, 30, 30],
      startAutoResizer: () => {
        observer ??= new MutationObserver(updateFrameHeight);
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
        });
        updateFrameHeight();
      },
      stopAutoResizer: () => observer?.disconnect(),
      isAutoResizerActive: () => observer !== null,
      updateHeight: updateFrameHeight,
      updatePluginParameters: async (next: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        parameters = next;
        render();
      },
    } as unknown as RenderConfigScreenCtx;
    root.render(<ConfigScreen ctx={ctx} />);
    return;
  }

  const ctx = {
    ...baseCtx(),
    mode: 'renderPage',
    bodyPadding: [0, 0, 0, 0],
    pageId: 'wf.wf-editorial.st.review',
    location: { pathname: '/', search: '', hash: '' },
  } as unknown as RenderPageCtx;
  const menuItem =
    params.get('data') === 'unknown' ? null : readMenuItems(parameters)[0];
  root.render(<StagePage ctx={ctx} menuItem={menuItem} />);
}

render();
