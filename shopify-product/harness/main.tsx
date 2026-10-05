// Runs inside the plugin iframe (frame.html). Same CSS order as src/main.tsx.
import 'datocms-react-ui/styles.css';
import '../src/kit-fixes.css';
import { Component, type ReactNode, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { cloneIntoThisRealm, getHost, type InspectorEntry } from './bridge';
import tokensCss from './datocms-tokens.css?raw';
import { KIND_LAYOUT } from './layout';
import {
  buildConfigCtx,
  buildFieldConfigCtx,
  buildFieldCtx,
  buildModalCtx,
  type ConfirmMode,
  createStore,
  fieldConfigErrors,
  fieldPathFor,
  getPath,
  type MockEnv,
  type MockStore,
  type ModalBinding,
  standaloneModalBinding,
} from './mockCtx';
import {
  findModalSurface,
  findSurface,
  resolveState,
  surfaces,
} from './registry';
import { createFrameSizing } from './sizing';
import type { AnySurface, ResolvedState } from './surface';
import { resolveDesignTokens } from './tokens';

/**
 * The frame side of the harness: renders one surface (`?surface=&state=`) or,
 * for frames the host opens through `ctx.openModal`, the modal surface of a
 * session (`?modalSession=`). It never calls `connect()`: the mock ctx stands
 * in for the dashboard.
 */

const params = new URLSearchParams(window.location.search);
const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
const confirm: ConfirmMode =
  params.get('confirm') === 'cancel' ? 'cancel' : 'first';
const host = getHost();

// What connect() does on <html>: the kit, light-dark() and native controls rely on it.
document.documentElement.dataset.colorScheme = scheme;
document.documentElement.style.colorScheme = scheme;

// `still=1`: no CSS transitions, for screenshots. Headless Chrome never
// advances a frame's animation timeline, so anything that just changed state
// (a button turning disabled, a selected card) would be shot at the first
// frame of its transition.
if (params.has('still')) {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(style);
}

const cssDesignTokens = resolveDesignTokens(tokensCss, scheme);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}
const root = createRoot(container);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type BoundaryState = { error: Error | null };

/** Shows a render crash in the frame instead of a blank screenshot. */
class HarnessErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <HarnessMessage title="The surface crashed while rendering">
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {error.stack ?? error.message}
        </pre>
      </HarnessMessage>
    );
  }
}

/** Sizes the frame while a harness message is up (there's no Canvas then). */
const messageSizing = createFrameSizing({ fixed: false });

/** Harness-level messages; plain HTML, since there may be no ctx. */
function HarnessMessage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  useEffect(() => {
    messageSizing.startAutoResizer();
    return () => messageSizing.stopAutoResizer();
  }, []);

  return (
    <div
      style={{
        padding: 20,
        font: '14px/1.5 system-ui, sans-serif',
        color: 'CanvasText',
      }}
    >
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function mount(element: ReactNode): void {
  root.render(
    <StrictMode>
      <HarnessErrorBoundary>{element}</HarnessErrorBoundary>
    </StrictMode>,
  );
}

function renderSurface(
  surface: AnySurface,
  state: ResolvedState,
  env: MockEnv,
  store: MockStore,
  modal: ModalBinding,
): ReactNode {
  switch (surface.kind) {
    case 'config':
      return surface.render(
        (overrides) => buildConfigCtx(env, store, state, overrides),
        state,
      );
    case 'fieldConfig': {
      const errors = fieldConfigErrors(store, state, surface.validate);
      return surface.render(
        (overrides) =>
          buildFieldConfigCtx(env, store, state, errors, overrides),
        state,
      );
    }
    case 'field':
      return surface.render(
        (overrides) => buildFieldCtx(env, store, state, overrides),
        state,
      );
    case 'modal':
      return surface.render(
        (overrides) => buildModalCtx(env, store, state, modal, overrides),
        state,
      );
  }
}

function inspectorEntries(
  surface: AnySurface,
  state: ResolvedState,
  store: MockStore,
  extra: InspectorEntry[],
): InspectorEntry[] {
  switch (surface.kind) {
    case 'config':
      return [
        {
          label: 'plugin.attributes.parameters',
          value: store.pluginParameters,
        },
      ];
    case 'fieldConfig':
      return [
        { label: 'ctx.parameters', value: store.fieldParameters },
        {
          label: 'ctx.errors',
          value: fieldConfigErrors(store, state, surface.validate),
        },
      ];
    case 'field': {
      const fieldPath = fieldPathFor(state);
      return [
        {
          label: `formValues.${fieldPath}`,
          value: getPath(store.formValues, fieldPath) ?? null,
        },
        { label: 'ctx.parameters', value: store.fieldParameters },
      ];
    }
    case 'modal':
      return extra;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function createEnv(bodyPadding: number, fixed: boolean): MockEnv {
  return {
    scheme,
    cssDesignTokens,
    bodyPadding,
    sizing: createFrameSizing({ fixed }),
    host,
    confirm,
    rerender: () => undefined,
  };
}

/** `?surface=&state=`: the page's main frame. */
function bootSurface(): void {
  const surface = findSurface(params.get('surface')) ?? surfaces[0];
  if (!surface) {
    mount(<HarnessMessage title="No surfaces in harness/surfaces/ yet." />);
    return;
  }
  const state = resolveState(surface, params.get('state'));
  const store = createStore(state);
  const env = createEnv(KIND_LAYOUT[surface.kind].bodyPadding, false);
  const modalParameters = cloneIntoThisRealm(state.modalParameters ?? {});
  let resolved: InspectorEntry[] = [
    { label: 'ctx.parameters', value: modalParameters },
  ];
  const modal = standaloneModalBinding(
    env,
    surface.id,
    modalParameters,
    (value) => {
      resolved = [...resolved, { label: 'ctx.resolve(…)', value }];
      render();
    },
  );

  const render = () => {
    mount(renderSurface(surface, state, env, store, modal));
    host?.inspect(inspectorEntries(surface, state, store, resolved));
    if (surface.kind === 'fieldConfig') {
      const errors = fieldConfigErrors(store, state, surface.validate);
      host?.setInvalid(Object.keys(errors).length > 0);
    }
  };

  env.rerender = render;
  render();
}

/** `?modalSession=`: a modal frame the host opened for `ctx.openModal`. */
function bootModalSession(sessionId: string): void {
  const session = host?.modalSession(sessionId);
  if (!host || !session) {
    mount(<HarnessMessage title={`Unknown modal session "${sessionId}".`} />);
    return;
  }
  const modal = cloneIntoThisRealm(session.modal);
  const close = () => host.resolveModal(sessionId, null);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      host.dismissModal(sessionId);
    }
  });

  const surface = findModalSurface(modal.id);
  if (!surface) {
    mount(
      <HarnessMessage title={`No modal surface has the id "${modal.id}".`}>
        <p>
          Add <code>harness/surfaces/&lt;name&gt;.tsx</code> with{' '}
          <code>kind: 'modal'</code> and <code>id: '{modal.id}'</code>.
        </p>
        <button type="button" onClick={close}>
          Close
        </button>
      </HarnessMessage>,
    );
    return;
  }

  const fullWidth = modal.width === 'fullWidth';
  const env = createEnv(
    fullWidth ? 0 : KIND_LAYOUT.modal.bodyPadding,
    fullWidth,
  );
  const state: ResolvedState = {
    name: 'opened',
    uiLocale: session.uiLocale,
    pluginParameters: cloneIntoThisRealm(session.pluginParameters),
  };
  const store = createStore(state);
  const binding: ModalBinding = {
    modalId: modal.id,
    parameters: cloneIntoThisRealm(modal.parameters ?? {}),
    resolve: async (value) => {
      console.info('[ctx] resolve', value);
      host.resolveModal(sessionId, value);
    },
  };

  const render = () =>
    mount(renderSurface(surface, state, env, store, binding));
  env.rerender = render;
  render();
}

const sessionId = params.get('modalSession');
if (sessionId) {
  bootModalSession(sessionId);
} else {
  bootSurface();
}
