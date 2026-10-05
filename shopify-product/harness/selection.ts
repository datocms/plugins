import type { AnySurface, ResolvedState } from './surface';

/**
 * Picks what `?surface=<id>&state=<name>` asks for. An omitted (or empty)
 * parameter means the first surface or state. A typo is a problem, never a
 * fallback, so a bare screenshot can't quietly capture something else. The
 * host page and the frame both use this, so they always agree.
 */

export const DEFAULT_STATE_NAME = 'default';

export type Choice = { value: string; label: string };

export type SelectionProblem = {
  /** One line, for the message, the tab title and the console. */
  title: string;
  /** The query parameter that picks one of `choices`. */
  param: 'surface' | 'state';
  choices: Choice[];
};

export type Selection =
  | { kind: 'ready'; surface: AnySurface; state: ResolvedState }
  | { kind: 'problem'; problem: SelectionProblem };

export function stateNames(surface: AnySurface): string[] {
  const names = Object.keys(surface.states ?? {});
  return names.length > 0 ? names : [DEFAULT_STATE_NAME];
}

function requestedValue(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}

function problem(
  title: string,
  param: SelectionProblem['param'],
  choices: Choice[],
): Selection {
  return { kind: 'problem', problem: { title, param, choices } };
}

function selectState(
  surface: AnySurface,
  requested: string | null,
): Selection {
  const names = stateNames(surface);
  const name = requested ?? names[0];
  if (!names.includes(name)) {
    return problem(
      `Surface "${surface.id}" has no state "${name}"`,
      'state',
      names.map((value) => ({
        value,
        label: surface.states?.[value]?.description ?? '',
      })),
    );
  }
  const state: ResolvedState = { ...(surface.states?.[name] ?? {}), name };
  return { kind: 'ready', surface, state };
}

export function selectSurface(
  list: readonly AnySurface[],
  surfaceId: string | null,
  stateName: string | null,
): Selection {
  const requested = requestedValue(surfaceId);
  const surface =
    requested === null
      ? list[0]
      : list.find((candidate) => candidate.id === requested);
  if (surface) {
    return selectState(surface, requestedValue(stateName));
  }
  if (list.length === 0) {
    return problem(
      'No surfaces in harness/surfaces/ yet (see harness/README.md)',
      'surface',
      [],
    );
  }
  return problem(
    `Unknown surface "${requested}"`,
    'surface',
    list.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.title} (${candidate.kind})`,
    })),
  );
}
