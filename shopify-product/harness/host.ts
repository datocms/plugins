import type { HarnessHostApi, InspectorEntry } from './bridge';
import { button, el, formatValue } from './dom';
import { createModalLayer, modalPanel } from './hostModal';
import { createToastStrip } from './hostToasts';
import {
  defaultFrameWidth,
  KIND_LAYOUT,
  MODAL_BODY_INSET,
  parseWidth,
  WIDTH_PRESETS,
} from './layout';
import { findSurface, resolveState, stateNames, surfaces } from './registry';
import { type AnySurface, type ResolvedState, SURFACE_KINDS } from './surface';

/**
 * The harness host (index.html): a stand-in for the dashboard around one
 * plugin iframe sized like the real one. It paints `--color--surface` or
 * `--color--surface-raised` behind the frame, draws the host chrome next to
 * it (field label, "Plugin settings", the field config box, the modal panel),
 * and serves toasts and modals to its frames through `window.__harnessHost`.
 *
 * URL: `?surface=<id>&state=<name>&scheme=light|dark&width=<px>` plus
 * `bare=1` (no toolbar or inspector, for clean screenshots),
 * `confirm=cancel` (openConfirm answers cancel instead of the first choice)
 * and `still=1` (no CSS transitions in the frames, for screenshots).
 */

const params = new URLSearchParams(window.location.search);
const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
const bare = params.get('bare') === '1';

type StageParts = { stage: HTMLElement; box: HTMLElement | null };

function hrefWith(changes: Record<string, string | null>): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  return `?${next.toString()}`;
}

function frameQuery(extra: Record<string, string>): string {
  const query = new URLSearchParams({ scheme, ...extra });
  for (const key of ['confirm', 'still']) {
    const value = params.get(key);
    if (value) {
      query.set(key, value);
    }
  }
  return `./frame.html?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function navigateOnChange(select: HTMLSelectElement, key: string): void {
  select.addEventListener('change', () => {
    const changes: Record<string, string | null> = { [key]: select.value };
    if (key === 'surface') {
      changes.state = null;
      changes.width = null;
    }
    window.location.search = hrefWith(changes);
  });
}

function surfaceSelect(current: AnySurface): HTMLSelectElement {
  const select = el('select', {
    className: 'hx-select',
    attributes: { 'aria-label': 'Surface' },
  });
  for (const kind of SURFACE_KINDS) {
    const group = surfaces.filter((surface) => surface.kind === kind);
    if (group.length === 0) {
      continue;
    }
    const optgroup = el('optgroup', {
      attributes: { label: KIND_LAYOUT[kind].label },
    });
    for (const surface of group) {
      const option = el('option', {
        text: surface.title,
        attributes: { value: surface.id },
      });
      option.selected = surface.id === current.id;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  navigateOnChange(select, 'surface');
  return select;
}

function stateSelect(surface: AnySurface, current: string): HTMLSelectElement {
  const select = el('select', {
    className: 'hx-select',
    attributes: { 'aria-label': 'State' },
  });
  for (const name of stateNames(surface)) {
    const option = el('option', { text: name, attributes: { value: name } });
    option.selected = name === current;
    select.append(option);
  }
  navigateOnChange(select, 'state');
  return select;
}

function linkGroup(
  label: string,
  links: Array<{ text: string; href: string; current: boolean }>,
): HTMLElement {
  return el('div', { className: 'hx-group' }, [
    el('span', { className: 'hx-group__label', text: label }),
    ...links.map((link) => {
      const anchor = el('a', {
        className: 'hx-link',
        text: link.text,
        attributes: { href: link.href },
      });
      if (link.current) {
        anchor.setAttribute('aria-current', 'true');
      }
      return anchor;
    }),
  ]);
}

function widthLinks(surface: AnySurface, frameWidth: number) {
  const presets = WIDTH_PRESETS[surface.kind];
  const links = presets.map((preset) => ({
    text: `${preset.label} (${preset.frameWidth})`,
    href: hrefWith({ width: String(preset.frameWidth) }),
    current: preset.frameWidth === frameWidth,
  }));
  if (!presets.some((preset) => preset.frameWidth === frameWidth)) {
    links.push({ text: `${frameWidth}`, href: hrefWith({}), current: true });
  }
  return links;
}

function buildToolbar(
  surface: AnySurface,
  state: ResolvedState,
  frameWidth: number,
): HTMLElement {
  const schemes = (['light', 'dark'] as const).map((value) => ({
    text: value,
    href: hrefWith({ scheme: value }),
    current: value === scheme,
  }));
  const description = [surface.description, state.description]
    .filter(Boolean)
    .join(' ');

  return el('header', { className: 'hx-toolbar' }, [
    el('div', { className: 'hx-toolbar__row' }, [
      el('strong', { className: 'hx-title', text: 'Shopify product harness' }),
      el('div', { className: 'hx-group' }, [
        surfaceSelect(surface),
        stateSelect(surface, state.name),
      ]),
      linkGroup('Scheme', schemes),
      linkGroup('Frame', widthLinks(surface, frameWidth)),
      el('a', {
        className: 'hx-link',
        text: 'bare',
        attributes: { href: hrefWith({ bare: '1' }) },
      }),
    ]),
    el('p', {
      className: 'hx-description',
      text: description || `${KIND_LAYOUT[surface.kind].label} · ${state.name}`,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Stage: the host surface, its chrome and the frame
// ---------------------------------------------------------------------------

function buildFrame(
  surface: AnySurface,
  state: ResolvedState,
  frameWidth: number,
): HTMLIFrameElement {
  const { bodyPadding, initialHeight } = KIND_LAYOUT[surface.kind];
  const height = (state.initialHeight ?? initialHeight) + 2 * bodyPadding;
  return el('iframe', {
    className: 'hx-frame',
    attributes: {
      title: surface.title,
      src: frameQuery({ surface: surface.id, state: state.name }),
    },
    style: {
      width: `${frameWidth}px`,
      height: `${height}px`,
      // The bleed contract: the host pulls the frame out by its body padding.
      margin: `-${bodyPadding}px`,
    },
  });
}

function column(width: number, children: Node[]): HTMLElement {
  return el(
    'div',
    { className: 'hx-column', style: { width: `${width}px` } },
    children,
  );
}

function stageContent(
  surface: AnySurface,
  state: ResolvedState,
  frame: HTMLIFrameElement,
  frameWidth: number,
): {
  content: HTMLElement;
  /** Gets the background; null paints the whole stage. */
  painted: HTMLElement | null;
  box: HTMLElement | null;
} {
  const width = frameWidth - 2 * KIND_LAYOUT[surface.kind].bodyPadding;
  switch (surface.kind) {
    case 'config': {
      const content = column(width, [
        el('h2', { className: 'hx-host-title', text: 'Plugin settings' }),
        frame,
      ]);
      return { content, painted: null, box: null };
    }
    case 'field': {
      const label = state.fieldLabel ?? 'Shopify product';
      const content = column(width, [
        el('div', { className: 'hx-field-label', text: label }),
        frame,
      ]);
      return { content, painted: null, box: null };
    }
    case 'fieldConfig': {
      const box = el(
        'div',
        { className: 'hx-box', style: { width: `${width}px` } },
        [
          el('div', { className: 'hx-box__title', text: 'Shopify product' }),
          frame,
        ],
      );
      return { content: box, painted: null, box };
    }
    case 'modal': {
      const panel = modalPanel(frame, {
        panelWidth: width + 2 * MODAL_BODY_INSET,
        title: state.modalTitle,
      });
      return { content: panel, painted: panel, box: null };
    }
  }
}

function buildStage(
  surface: AnySurface,
  state: ResolvedState,
  frameWidth: number,
): StageParts {
  const frame = buildFrame(surface, state, frameWidth);
  const { content, painted, box } = stageContent(
    surface,
    state,
    frame,
    frameWidth,
  );
  const stage = el(
    'main',
    { className: `hx-stage hx-stage--${surface.kind}` },
    [content],
  );
  (painted ?? stage).dataset.background =
    state.background ?? KIND_LAYOUT[surface.kind].background;
  return { stage, box };
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function createInspector(): {
  element: HTMLElement;
  update: (entries: InspectorEntry[]) => void;
} {
  const list = el('div', { className: 'hx-inspector__list' });
  const element = el('section', { className: 'hx-inspector' }, [
    el('h2', { className: 'hx-inspector__title', text: 'Mock state' }),
    list,
  ]);
  const update = (entries: InspectorEntry[]) => {
    list.replaceChildren(
      ...entries.map((entry) =>
        el('div', { className: 'hx-inspector__entry' }, [
          el('code', { className: 'hx-inspector__label', text: entry.label }),
          el('pre', {
            className: 'hx-inspector__value',
            text: formatValue(entry.value),
          }),
        ]),
      ),
    );
  };
  return { element, update };
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function installHostApi(
  toast: HarnessHostApi['toast'],
  inspector: ReturnType<typeof createInspector> | null,
  getBox: () => HTMLElement | null,
): void {
  const modals = createModalLayer((sessionId) =>
    frameQuery({ modalSession: sessionId }),
  );
  window.__harnessHost = {
    toast,
    openModal: modals.openModal,
    modalSession: modals.session,
    resolveModal: modals.resolve,
    dismissModal: modals.dismiss,
    inspect: (entries) => inspector?.update(entries),
    setInvalid: (invalid) =>
      getBox()?.classList.toggle('hx-box--invalid', invalid),
  };
}

function mountEmpty(): void {
  document.body.append(
    el('main', { className: 'hx-stage' }, [
      el('p', {
        text: 'No surfaces yet. Add a file to harness/surfaces/ (see harness/README.md).',
      }),
      button('Reload', () => window.location.reload()),
    ]),
  );
}

function mount(): void {
  const surface = findSurface(params.get('surface')) ?? surfaces[0];
  if (!surface) {
    mountEmpty();
    return;
  }
  const state = resolveState(surface, params.get('state'));
  const frameWidth =
    parseWidth(params.get('width')) ?? defaultFrameWidth(surface.kind, state);
  document.title = `${surface.title} · ${state.name} · harness`;

  const toasts = createToastStrip();
  const inspector = bare ? null : createInspector();
  let box: HTMLElement | null = null;
  // Before the frame exists: its main.tsx reads the API on boot.
  installHostApi(toasts.show, inspector, () => box);

  const parts = buildStage(surface, state, frameWidth);
  box = parts.box;
  document.body.append(
    ...(bare ? [] : [buildToolbar(surface, state, frameWidth)]),
    parts.stage,
    ...(inspector ? [inspector.element] : []),
    toasts.element,
  );
}

mount();
