/**
 * Structural translation for DatoCMS `json` fields.
 *
 * A JSON field's value is one string holding a JSON document. Sending that raw
 * text to a provider as prose invites disaster: models translate the KEYS and
 * mangle syntax (observed: DeepL turned `"estimatedMinutes": 8` into
 * `"tempo estimado": 8 minutos` — unquoted, i.e. no longer JSON), and DatoCMS
 * then rejects the save with a locale-level 422 the editor can't act on.
 *
 * Instead: parse the document, translate ONLY its non-empty string leaf values
 * (object values and array elements — never keys, numbers, booleans, null),
 * and re-serialize. The output is valid JSON by construction and placeholder
 * tokens still round-trip through translateArray's protection. A source that
 * doesn't parse falls back to the legacy plain-text path with a warning flag —
 * DatoCMS won't have stored an invalid document, so this only guards drafts
 * and hand-edited form state.
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import type { StreamCallbacks } from './types';
import type { TranslationProvider } from './types';
import type { OnQcFlag } from './qc/types';
import { translateDefaultFieldValue } from './DefaultTranslation';
import { translateArray } from './translateArray';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Options bag mirroring the shape `translateDefaultFieldValue` accepts. */
export type JsonTranslationOptions = {
  onQcFlag?: OnQcFlag;
};

/** Collect every non-empty string leaf, depth-first (matching rebuild order). */
function collectStringLeaves(value: JsonValue, out: string[]): void {
  if (typeof value === 'string') {
    if (value !== '') out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStringLeaves(entry, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) collectStringLeaves(value[key], out);
  }
}

/** Rebuild the document with translated leaves, consuming them in collect order. */
function rebuildWithLeaves(
  value: JsonValue,
  translated: string[],
  cursor: { index: number },
): JsonValue {
  if (typeof value === 'string') {
    if (value === '') return value;
    const next = translated[cursor.index];
    cursor.index += 1;
    return typeof next === 'string' ? next : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rebuildWithLeaves(entry, translated, cursor));
  }
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value)) {
      out[key] = rebuildWithLeaves(value[key], translated, cursor);
    }
    return out;
  }
  return value;
}

/**
 * Translates a `json` field value structurally, guaranteeing the result still
 * parses. Signature mirrors {@link translateDefaultFieldValue} so
 * `TranslateField` can route to it symmetrically.
 */
export async function translateJsonFieldValue(
  fieldValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  streamCallbacks?: StreamCallbacks,
  recordContext = '',
  options: JsonTranslationOptions = {},
): Promise<unknown> {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
    return fieldValue;
  }

  const text = String(fieldValue);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    // Not a JSON document (an unsaved draft / hand-edited form state): the
    // structural guarantee is impossible, so translate as plain text like the
    // legacy path did — but say so, since the result may not validate.
    options.onQcFlag?.({
      checkId: 'json-validity',
      severity: 'warning',
      message:
        'The JSON field value is not valid JSON, so it was translated as plain text — review it before saving.',
    });
    return translateDefaultFieldValue(
      fieldValue,
      pluginParams,
      toLocale,
      fromLocale,
      provider,
      streamCallbacks,
      recordContext,
      { kind: 'text', onQcFlag: options.onQcFlag },
    );
  }

  const leaves: string[] = [];
  collectStringLeaves(parsed, leaves);
  if (leaves.length === 0) return fieldValue;

  const translated = await translateArray(
    provider,
    pluginParams,
    leaves,
    fromLocale,
    toLocale,
    {
      kind: 'text',
      recordContext,
      // Leaves are independent snippets, not fragments of one prose value —
      // per-segment no-op semantics fit them.
      qcAtomicSegments: true,
      onQcFlag: options.onQcFlag,
    },
  );

  const rebuilt = rebuildWithLeaves(parsed, translated, { index: 0 });
  return JSON.stringify(rebuilt, null, 2);
}
