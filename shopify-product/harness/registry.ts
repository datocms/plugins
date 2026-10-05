import { isRecord } from '../src/lib/guards';
import { type Selection, selectSurface, stateNames } from './selection';
import {
  type AnySurface,
  type ResolvedState,
  SURFACE_KINDS,
  type SurfaceKind,
} from './surface';

/**
 * Discovers every `harness/surfaces/*.tsx`. Each file default-exports a
 * surface (or exports `id`, `title`, `kind` and `render` by name). Both the
 * host page and the frame import this, so they agree on the list.
 */
const modules = import.meta.glob<Record<string, unknown>>('./surfaces/*.tsx', {
  eager: true,
});

function isSurfaceKind(value: unknown): value is SurfaceKind {
  return SURFACE_KINDS.some((kind) => kind === value);
}

function isSurface(value: unknown): value is AnySurface {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.title === 'string' &&
    isSurfaceKind(value.kind) &&
    typeof value.render === 'function'
  );
}

function surfaceFromModule(
  path: string,
  module: Record<string, unknown>,
): AnySurface | null {
  const candidate = isRecord(module.default) ? module.default : module;
  if (isSurface(candidate)) {
    return candidate;
  }
  console.warn(
    `[harness] ${path} does not export a surface: it needs id, title, kind and render.`,
  );
  return null;
}

function compareSurfaces(a: AnySurface, b: AnySurface): number {
  const byKind = SURFACE_KINDS.indexOf(a.kind) - SURFACE_KINDS.indexOf(b.kind);
  return byKind !== 0 ? byKind : a.title.localeCompare(b.title);
}

function loadSurfaces(): AnySurface[] {
  const byId = new Map<string, AnySurface>();
  for (const [path, module] of Object.entries(modules)) {
    const surface = surfaceFromModule(path, module);
    if (!surface) {
      continue;
    }
    if (byId.has(surface.id)) {
      console.warn(
        `[harness] Duplicate surface id "${surface.id}" in ${path}; keeping the first one.`,
      );
      continue;
    }
    byId.set(surface.id, surface);
  }
  return [...byId.values()].sort(compareSurfaces);
}

export const surfaces: readonly AnySurface[] = loadSurfaces();

/** The surface and state for `?surface=&state=`, or why there is none. */
export function selectFromQuery(params: URLSearchParams): Selection {
  const selection = selectSurface(
    surfaces,
    params.get('surface'),
    params.get('state'),
  );
  if (selection.kind === 'problem') {
    console.warn(`[harness] ${selection.problem.title}.`);
  }
  return selection;
}

/** The `modal` surface whose id is the `ctx.openModal({ id })` modal id. */
export function findModalSurface(modalId: string): AnySurface | undefined {
  return surfaces.find(
    (surface) => surface.kind === 'modal' && surface.id === modalId,
  );
}

export { stateNames };

/** The surface for `?surface=`; the first one when omitted. Warns on a typo. */
export function findSurface(id: string | null): AnySurface | undefined {
  if (!id) return surfaces[0];
  const found = surfaces.find((surface) => surface.id === id);
  if (!found) {
    console.warn(
      `[harness] Unknown surface "${id}". Known: ${surfaces.map((s) => s.id).join(', ')}`,
    );
  }
  return found;
}

/** The named state (the first one when omitted). Warns on a typo. */
export function resolveState(
  surface: AnySurface,
  name: string | null,
): ResolvedState {
  const names = stateNames(surface);
  const known = name !== null && name !== '' && names.includes(name);
  if (name && !known) {
    console.warn(
      `[harness] Surface "${surface.id}" has no state "${name}". Known: ${names.join(', ')}`,
    );
  }
  const chosen = known ? name : names[0];
  return { ...(surface.states?.[chosen] ?? {}), name: chosen };
}
