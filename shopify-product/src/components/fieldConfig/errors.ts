import type { FieldParametersV1 } from '../../types';

/** `ctx.errors` keyed by parameter, as `validateFieldParameters` returns them. */
export type FieldErrors = Partial<Record<string, string>>;

export function readErrors(
  raw: Record<string, unknown> | undefined,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === 'string' && value.trim()) errors[key] = value;
  }
  return errors;
}

export type VisibleControls = {
  cardinality: boolean;
  limits: boolean;
  snapshot: boolean;
  store: boolean;
  scope: boolean;
};

/**
 * Which controls the screen shows. The store select appears with several
 * stores, or with one when the field points at a store that was removed (and
 * stays while that change is pending, next to its warning).
 */
export function visibleControls(
  params: FieldParametersV1,
  stores: { count: number; fieldStoreMissing: boolean; storeChanged: boolean },
): VisibleControls {
  const reference = params.format === 'reference';
  const singleStoreNeedsChoice =
    stores.fieldStoreMissing || stores.storeChanged;
  return {
    cardinality: reference,
    limits: reference && params.cardinality === 'multiple',
    snapshot: reference,
    store: stores.count > 1 || (stores.count > 0 && singleStoreNeedsChoice),
    scope: params.kind !== 'collection',
  };
}

/** Errors about which options go together (kind, format, cardinality, snapshot). */
const COMBINATION_KEYS = ['kind', 'format', 'cardinality', 'snapshot'];

export type ErrorPlacement = {
  /** The notice about settings from an unknown version is shown. */
  showsUnsupported: boolean;
  /**
   * The controls show corrected settings, so errors about the saved
   * combination are listed above them, next to the action that fixes them.
   */
  repairing: boolean;
};

/** The error keys a visible control shows next to itself. */
function placedKeys(
  visible: VisibleControls,
  placement: ErrorPlacement,
): string[] {
  const keys = ['kind', 'format'];
  if (visible.cardinality) keys.push('cardinality');
  if (visible.limits) keys.push('min', 'max');
  if (visible.snapshot) keys.push('snapshot');
  if (visible.store) keys.push('shopDomain');
  if (visible.scope) keys.push('scope');
  if (placement.showsUnsupported) keys.push('paramsVersion');
  return placement.repairing
    ? keys.filter((key) => !COMBINATION_KEYS.includes(key))
    : keys;
}

/** The errors each control shows (none about the saved combination while repairing). */
export function controlErrors(
  errors: FieldErrors,
  placement: ErrorPlacement,
): FieldErrors {
  if (!placement.repairing) return errors;
  const result: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    if (!COMBINATION_KEYS.includes(key)) result[key] = message;
  }
  return result;
}

/** Errors with no visible control, so they're listed above the settings instead. */
export function strayErrors(
  errors: FieldErrors,
  visible: VisibleControls,
  placement: ErrorPlacement,
): string[] {
  const placed = placedKeys(visible, placement);
  const messages: string[] = [];
  for (const [key, message] of Object.entries(errors)) {
    if (message && !placed.includes(key) && !messages.includes(message)) {
      messages.push(message);
    }
  }
  return messages;
}
