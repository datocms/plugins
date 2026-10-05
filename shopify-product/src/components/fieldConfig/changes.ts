/**
 * What a saved field's pending settings change for the values its records
 * already hold. Each change gets its own warning next to the control.
 */

import {
  getActiveStores,
  resolveFieldStore,
  storeLabel,
} from '../../lib/parameters';
import type { FieldParametersV1, PluginParametersV3 } from '../../types';
import { sameDomain } from './draft';

export type SavedChanges = {
  /** Another kind or format: existing values no longer match the field. */
  format: boolean;
  /** Multiple back to one: lists with several items no longer fit. */
  cardinality: boolean;
  /** The store existing values point to, when the field moves to another one. */
  previousStore: string | null;
};

export const NO_CHANGES: SavedChanges = {
  format: false,
  cardinality: false,
  previousStore: null,
};

/** The domain a field's values point to: its own store, or the default one. */
function fieldDomain(
  plugin: PluginParametersV3,
  params: FieldParametersV1,
): string | null {
  return (
    resolveFieldStore(plugin, params.shopDomain)?.shopDomain ??
    params.shopDomain ??
    null
  );
}

function domainLabel(plugin: PluginParametersV3, domain: string): string {
  const store = getActiveStores(plugin).find((candidate) =>
    sameDomain(candidate.shopDomain, domain),
  );
  return store ? storeLabel(store) : domain;
}

export function changesSinceSaved(
  saved: FieldParametersV1,
  current: FieldParametersV1,
  plugin: PluginParametersV3,
): SavedChanges {
  const format = saved.format !== current.format || saved.kind !== current.kind;
  const savedDomain = fieldDomain(plugin, saved);
  const currentDomain = fieldDomain(plugin, current);
  const storeChanged =
    savedDomain !== null &&
    currentDomain !== null &&
    !sameDomain(savedDomain, currentDomain);
  return {
    format,
    // A format change already covers it (and resets the cardinality).
    cardinality:
      !format &&
      saved.cardinality === 'multiple' &&
      current.cardinality === 'single',
    previousStore:
      storeChanged && savedDomain ? domainLabel(plugin, savedDomain) : null,
  };
}
