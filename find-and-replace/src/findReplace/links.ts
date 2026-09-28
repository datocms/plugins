import type { RecordLink } from './contract';

export type RecordLinkOptions = {
  /** The project's admin domain; null when the host doesn't know it. */
  internalDomain: string | null;
  isEnvironmentPrimary: boolean;
  environment: string;
};

/** `{/environments/x}/editor/item_types/{model}/items/{record}/edit`. */
export function recordEditorPath(
  options: Pick<RecordLinkOptions, 'isEnvironmentPrimary' | 'environment'>,
  modelId: string,
  recordId: string,
): string {
  const environment = options.isEnvironmentPrimary
    ? ''
    : `/environments/${encodeURIComponent(options.environment)}`;
  return `${environment}/editor/item_types/${encodeURIComponent(
    modelId,
  )}/items/${encodeURIComponent(recordId)}/edit`;
}

/**
 * Where "Open record" goes: a new tab on the admin domain when it is known,
 * else the same path for `ctx.navigateTo`.
 */
export function recordLink(
  options: RecordLinkOptions,
  modelId: string,
  recordId: string,
): RecordLink {
  const path = recordEditorPath(options, modelId, recordId);
  return options.internalDomain
    ? { kind: 'href', href: `https://${options.internalDomain}${path}` }
    : { kind: 'path', path };
}

/** `RecordView.key` (`${modelId}:${recordId}`) back to its parts. */
export function parseRecordKey(
  recordKey: string,
): { modelId: string; recordId: string } | null {
  const separator = recordKey.indexOf(':');
  if (separator <= 0 || separator === recordKey.length - 1) return null;
  return {
    modelId: recordKey.slice(0, separator),
    recordId: recordKey.slice(separator + 1),
  };
}

export function recordKeyOf(modelId: string, recordId: string): string {
  return `${modelId}:${recordId}`;
}
