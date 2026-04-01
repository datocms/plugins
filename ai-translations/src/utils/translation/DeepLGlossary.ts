/**
 * DeepLGlossary.ts
 * ------------------------------------------------------
 * Utilities for resolving which DeepL glossary id to use for a given
 * source→target language pair based on plugin configuration.
 */

import { mapDatoToDeepL } from './DeepLMap';

/**
 * Minimum params shape needed for glossary resolution.
 * This avoids importing the full ctxParamsType and allows for flexibility.
 */
interface GlossaryParams {
  /** Default glossary ID applied to all translations. */
  deeplGlossaryId?: string;
  /** Per-pair glossary mappings in user-defined format. */
  deeplGlossaryPairs?: string;
}

/**
 * Parses a user-provided mapping of glossary ids by language pair.
 *
 * Accepts lines in the following flexible formats (case-insensitive):
 *   EN-\>DE=gls-abc123
 *   en-us -\> pt-br : gls-xyz789
 *   fr→it gls-123
 *   *-\>pt-BR=gls-777        (any source to target)
 *   pt-BR=gls-777           (shorthand for *-\>pt-BR)
 * Delimiters supported between pair and id: '=', ':', whitespace.
 *
 * @param input - Optional mapping text entered by the user.
 * @returns A normalized map keyed as "SRC:TGT" (uppercased) to glossary id.
 */
export function parseGlossaryMap(input?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!input) return map;
  const lines = String(input)
    .split(/\r?\n|[;,]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    // Split into pair and id
    const m = line.match(
      /^(.*?)\s*(?:=|:|\s)\s*((?:gls-)?[A-Za-z0-9_-]+)\s*$/i,
    );
    if (!m) continue;
    const pair = m[1].replace(/\s/g, '');
    const id = m[2];
    // Normalize arrow separators
    let arrow = pair.replace(/–|—|→|⇒/g, '->');
    // Shorthand: if only a single token (assume target-only), rewrite as *->TOKEN
    if (!arrow.includes('->')) arrow = `*->${arrow}`;
    const [rawSrc, rawTgt] = arrow.split(/->/);
    if (!rawSrc || !rawTgt) continue;
    // Store both raw key and uppercased DeepL-code key for robustness.
    const keyRaw = `${rawSrc}:${rawTgt}`.toUpperCase();
    map[keyRaw] = id;
  }
  return map;
}

/**
 * Resolves the glossary id to use for the pair (fromLocale → toLocale),
 * trying per-pair mappings first and falling back to a default id.
 * Keys in the mapping may use Dato locales (e.g., en-US-\>pt-BR) or DeepL
 * codes (e.g., EN-\>PT-BR). Both are normalized to DeepL codes internally.
 *
 * @param params - Plugin params object containing `deeplGlossaryId` and `deeplGlossaryPairs`.
 * @param fromLocale - Source locale (DatoCMS code), or undefined when unknown.
 * @param toLocale - Target locale (DatoCMS code).
 * @returns The resolved glossary id for this translation pair, if any.
 */
export function resolveGlossaryId(
  params: GlossaryParams | null | undefined,
  fromLocale: string | undefined,
  toLocale: string,
): string | undefined {
  const defaultId = params?.deeplGlossaryId;
  const rawMap = params?.deeplGlossaryPairs;
  if (!rawMap && !defaultId) return undefined;

  // Compute DeepL codes for the actual request
  const targetDeepL = mapDatoToDeepL(toLocale, 'target').toUpperCase();
  const sourceDeepL = fromLocale
    ? mapDatoToDeepL(fromLocale, 'source').toUpperCase()
    : '';
  const deepKey = `${sourceDeepL}:${targetDeepL}`;

  const map = parseGlossaryMap(rawMap);
  // Try exact DeepL-code match
  if (map[deepKey]) return map[deepKey];

  // Also try matching against raw locale casing provided by user
  if (fromLocale) {
    const rawKey = `${fromLocale}:${toLocale}`.toUpperCase();
    if (map[rawKey]) return map[rawKey];
  }

  // Wildcards: any source → this target
  const anyToTargetDeep = `*:${targetDeepL}`;
  if (map[anyToTargetDeep]) return map[anyToTargetDeep];
  const anyToTargetRaw = `*:${toLocale.toUpperCase()}`;
  if (map[anyToTargetRaw]) return map[anyToTargetRaw];

  // Wildcards: this source → any target
  if (sourceDeepL) {
    const sourceToAnyDeep = `${sourceDeepL}:*`;
    if (map[sourceToAnyDeep]) return map[sourceToAnyDeep];
    const sourceToAnyRaw = `${fromLocale?.toUpperCase()}:*`;
    if (map[sourceToAnyRaw]) return map[sourceToAnyRaw];
  }

  // Fallback to default ONLY if no pair mappings are configured.
  // If the user has configured specific pairs, we should not apply the default
  // glossary to other pairs - it likely doesn't support them and would cause
  // translations to fail silently or return original text.
  const hasPairMappings = Object.keys(map).length > 0;
  if (hasPairMappings) {
    return undefined;
  }
  return defaultId;
}
