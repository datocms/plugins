/**
 * StructuredTextTranslation.ts
 * ------------------------------------------------------
 * This file manages translations of structured text fields from DatoCMS.
 * It handles extracting text nodes, translating block nodes, and reassembling
 * the content after translation while preserving the original structure.
 *
 * The module provides functionality to:
 * - Extract and track text values from structured text nodes
 * - Process block nodes separately to maintain rich formatting
 * - Translate content while preserving structure
 * - Handle streaming responses from the provider
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger, type Logger } from '../logging/Logger';
import type { SchemaRepository } from '../schemaRepository';
import { handleTranslationError } from './ProviderErrors';
import { translateFieldValue } from './TranslateField';
import { translateArray } from './translateArray';
import { getCancellationOptions, rethrowAbortError } from './Cancellation';
import type { StreamCallbacks, TranslationProvider } from './types';
import { checkCancellation } from './Cancellation';
import { cloneContent } from './ContentIntegrity';

/**
 * Interface representing a structured text node from DatoCMS.
 * Includes standard properties and allows for additional dynamic properties.
 */
interface StructuredTextNode {
  type?: string;
  value?: string;
  item?: string;
  originalIndex?: number;
  [key: string]: unknown;
}

/**
 * Interface for API response format with document wrapper.
 */
interface APIResponseFormat {
  document: {
    children: unknown[];
    type?: string;
  };
  schema?: string;
}

/**
 * Type guard to check if value is an API response format with document.children.
 *
 * @param value - The value to check.
 * @returns True if the value has a document.children array.
 */
function isAPIResponseFormat(value: unknown): value is APIResponseFormat {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (!obj.document || typeof obj.document !== 'object') return false;
  const doc = obj.document as Record<string, unknown>;
  return Array.isArray(doc.children);
}

/**
 * Comprehensive Unicode whitespace regex covering all Unicode space characters.
 * Includes standard whitespace plus: NBSP, Ogham Space, various Em/En spaces,
 * Figure/Punctuation/Thin/Hair spaces, Line/Paragraph separators,
 * Narrow NBSP, Mathematical space, and Ideographic space.
 */
const UNICODE_WHITESPACE_REGEX =
  /^[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/;

/**
 * Checks if a string is whitespace-only (empty or containing any Unicode whitespace).
 *
 * @param s - The string to check.
 * @returns True if the string is empty or whitespace-only.
 */
function isWhitespaceOnly(s: string): boolean {
  return s === '' || UNICODE_WHITESPACE_REGEX.test(s);
}

interface StructuredTextTextLeaf {
  node: Record<string, unknown>;
  key: 'text' | 'value';
  value: string;
}

interface StructuredTextBlockLocation {
  parent: unknown[];
  index: number;
  rootIndex?: number;
  node: StructuredTextNode;
}

function buildNestedTranslationOptions(cmaBaseUrl?: string) {
  return cmaBaseUrl
    ? { bypassFieldTypeAllowlist: true, cmaBaseUrl, contentAlreadyCloned: true }
    : { bypassFieldTypeAllowlist: true, contentAlreadyCloned: true };
}

function isBlockNode(node: StructuredTextNode): boolean {
  return node.type === 'block' || node.type === 'inlineBlock';
}

function getTextLeaf(node: StructuredTextNode): StructuredTextTextLeaf | undefined {
  if (typeof node.text === 'string') return { node, key: 'text', value: node.text };
  if (node.type === 'span' && typeof node.value === 'string') return { node, key: 'value', value: node.value };
  return undefined;
}

function replaceTranslatedBlocks(
  translatedNodes: StructuredTextNode[],
  locations: StructuredTextBlockLocation[],
): void {
  if (!Array.isArray(translatedNodes) || translatedNodes.length !== locations.length) {
    throw new Error('Embedded block translation returned an incomplete document');
  }
  for (let index = 0; index < locations.length; index++) {
    const location = locations[index];
    const { originalIndex: _originalIndex, ...node } = translatedNodes[index];
    location.parent[location.index] = node;
  }
}

/** Visit only document children: metadata and record references remain opaque. */
function collectContent(
  nodes: unknown[],
): { leaves: StructuredTextTextLeaf[]; blocks: StructuredTextBlockLocation[] } {
  const leaves: StructuredTextTextLeaf[] = [];
  const blocks: StructuredTextBlockLocation[] = [];
  const stack: Array<{ parent: unknown[]; index: number; isRoot: boolean }> = [];
  const enqueue = (parent: unknown[], isRoot: boolean) => {
    for (let index = parent.length - 1; index >= 0; index--) {
      stack.push({ parent, index, isRoot });
    }
  };
  enqueue(nodes, true);
  while (stack.length > 0) {
    const location = stack.pop();
    if (!location) continue;
    const value = location.parent[location.index];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const node = value as StructuredTextNode;
    // Editor node IDs belong to the copied document. Do not descend into
    // metadata or linked items, whose IDs carry independent identity.
    delete node.id;
    if (isBlockNode(node)) {
      blocks.push({
        parent: location.parent,
        index: location.index,
        ...(location.isRoot ? { rootIndex: location.index } : {}),
        node,
      });
      continue;
    }
    const leaf = getTextLeaf(node);
    if (leaf) {
      leaves.push(leaf);
    } else if (Array.isArray(node.children)) {
      enqueue(node.children, false);
    }
  }
  return { leaves, blocks };
}

/** Apply text to a private clone; the caller's source locale is never mutated. */
function rebuildStructuredTextLeaves<T>(
  originalValue: T,
  leaves: StructuredTextTextLeaf[],
  translatedValues: string[],
): T {
  for (let index = 0; index < leaves.length; index++) {
    const translatedValue = translatedValues[index];
    if (translatedValue !== undefined) {
      const leaf = leaves[index];
      leaf.node[leaf.key] = translatedValue;
    }
  }
  return originalValue;
}

/**
 * Ensures the array lengths match, with fallback strategies if they don't
 *
 * @param originalValues - Original array of text values.
 * @param translatedValues - Translated array that might need adjustment.
 * @returns Adjusted translated values array matching original length.
 */
function ensureArrayLengthsMatch(
  originalValues: string[],
  translatedValues: string[],
): string[] {
  if (originalValues.length === translatedValues.length) {
    return translatedValues;
  }

  // If too few elements, pad with the original values verbatim (including pure whitespace)
  // so that structural spaces between inline nodes are preserved.
  if (translatedValues.length < originalValues.length) {
    return [
      ...translatedValues,
      ...originalValues.slice(translatedValues.length),
    ];
  }

  // If too many elements, truncate to match original length
  return translatedValues.slice(0, originalValues.length);
}

/**
 * Preserves leading/trailing whitespace from the original strings onto the
 * translated strings. Many providers trim edges of segments when splitting
 * inline nodes (e.g., around bold/links), which causes words to concatenate
 * across boundaries. This re-applies the exact edge whitespace from the
 * original extracted nodes.
 *
 * @param originalValues - Original array of extracted strings (including pure whitespace nodes).
 * @param translatedValues - Translated strings returned by the provider.
 * @returns A new array with edge whitespace restored from the originals.
 */
function preserveEdgeWhitespace(
  originalValues: string[],
  translatedValues: string[],
): string[] {
  const out: string[] = new Array(translatedValues.length);
  for (let i = 0; i < translatedValues.length; i++) {
    const orig = String(originalValues[i] ?? '');
    const tr = String(translatedValues[i] ?? '');
    if (isWhitespaceOnly(orig)) {
      // Keep pure whitespace nodes exactly as in the original
      out[i] = orig;
      continue;
    }
    const leading = (orig.match(/^\s+/) || [''])[0];
    const trailing = (orig.match(/\s+$/) || [''])[0];

    let s = tr; // do NOT trim; only add missing edges when the original had them
    if (leading && !/^\s/.test(s)) s = `${leading}${s}`;
    if (trailing && !/\s$/.test(s)) s = `${s}${trailing}`;
    out[i] = s;
  }
  return out;
}

/**
 * Aligns translated segments back to the positions of the originals while
 * preserving pure-whitespace segments exactly where they were. Many models
 * drop or merge whitespace-only nodes; this ensures spacing nodes remain in
 * their original slots so that formatting boundaries don't eat spaces.
 *
 * @param originalValues - Original extracted strings (some may be whitespace only).
 * @param translatedValues - Translated strings that may have a different count.
 * @returns A translated array aligned to the original positions.
 */
function alignSegmentsPreservingWhitespace(
  originalValues: string[],
  translatedValues: string[],
): string[] {
  const out: string[] = [];
  let j = 0;
  for (let i = 0; i < originalValues.length; i++) {
    const orig = String(originalValues[i] ?? '');
    if (isWhitespaceOnly(orig)) {
      out.push(orig); // keep exact whitespace segment in place
    } else {
      const tr =
        j < translatedValues.length ? String(translatedValues[j++]) : orig;
      out.push(tr);
    }
  }
  return out;
}

/**
 * Ensures that boundaries between adjacent non-whitespace segments keep a
 * separating space when the original had one either at the end of the left
 * segment or at the start of the right segment. This guards against models
 * trimming edges and losing the space after inline marks (bold/links).
 *
 * @param originalValues - Original extracted strings.
 * @param processed - Translated strings after initial normalization.
 * @returns A defensively spaced translated array.
 */
function enforceBoundarySpaces(
  originalValues: string[],
  processed: string[],
): string[] {
  const out = processed.slice();
  for (let i = 0; i < originalValues.length - 1; i++) {
    const oL = String(originalValues[i] ?? '');
    const oR = String(originalValues[i + 1] ?? '');
    // If either side is a dedicated whitespace segment, leave as-is
    if (isWhitespaceOnly(oL) || isWhitespaceOnly(oR)) continue;

    const needSpace = /[\s\u00A0]$/.test(oL) || /^[\s\u00A0]/.test(oR);
    if (!needSpace) continue;

    const pL = String(out[i] ?? '');
    const pR = String(out[i + 1] ?? '');
    const leftHas = /[\s\u00A0]$/.test(pL);
    const rightHas = /^[\s\u00A0]/.test(pR);
    if (!leftHas && !rightHas) {
      out[i] = `${pL} `;
    }
  }
  return out;
}

/**
 * Additional guard: if the original left segment ended with punctuation
 * (comma/semicolon/colon/period/exclamation/question) but the translated
 * boundary has no punctuation and no space, inject a single space. This
 * covers cases where translators drop the comma inside a bold span and the
 * following word becomes attached.
 *
 * @param originalValues - Original extracted strings.
 * @param processed - Translated strings after boundary spacing.
 * @returns A translated array with punctuation boundaries respected.
 */
function enforcePunctuationBoundarySpaces(
  originalValues: string[],
  processed: string[],
): string[] {
  const out = processed.slice();
  for (let i = 0; i < originalValues.length - 1; i++) {
    const oL = String(originalValues[i] ?? '');
    const oR = String(originalValues[i + 1] ?? '');
    const endsPunctLeft = /[.,;:!?]$/.test(oL.trimEnd());
    const startsPunctRight = /^[.,;:!?]/.test(oR.trimStart());
    if (!endsPunctLeft && !startsPunctRight) continue;
    const pL = String(out[i] ?? '');
    const pR = String(out[i + 1] ?? '');
    const boundaryHasSpace = /[\s\u00A0]$/.test(pL) || /^[\s\u00A0]/.test(pR);
    const boundaryHasPunct = /[.,;:!?]$/.test(pL) || /^[.,;:!?]/.test(pR);
    if (!boundaryHasSpace && !boundaryHasPunct) {
      out[i] = `${pL} `;
    }
  }
  return out;
}

interface InlineTextTranslationParams {
  provider: TranslationProvider;
  pluginParams: ctxParamsType;
  textValues: string[];
  textLeaves: StructuredTextTextLeaf[];
  fieldValueWithoutBlocks: StructuredTextNode[];
  fromLocale: string;
  toLocale: string;
  recordContext: string;
  logger: Logger;
  streamCallbacks?: StreamCallbacks;
}

async function translateInlineTextLeaves({
  provider,
  pluginParams,
  textValues,
  textLeaves,
  fieldValueWithoutBlocks,
  fromLocale,
  toLocale,
  recordContext,
  logger,
  streamCallbacks,
}: InlineTextTranslationParams): Promise<StructuredTextNode[]> {
  const translatedValues = await translateArray(
    provider,
    pluginParams,
    textValues,
    fromLocale,
    toLocale,
    {
      isHTML: false,
      recordContext,
      ...getCancellationOptions(streamCallbacks),
    },
  );

  let processedTranslatedValues = translatedValues;

  if (translatedValues.length !== textValues.length) {
    logger.warning(
      `Translation mismatch: got ${translatedValues.length} values, expected ${textValues.length}`,
      { original: textValues, translated: translatedValues },
    );

    processedTranslatedValues = alignSegmentsPreservingWhitespace(
      textValues,
      translatedValues,
    );
    if (processedTranslatedValues.length !== textValues.length) {
      processedTranslatedValues = ensureArrayLengthsMatch(
        textValues,
        processedTranslatedValues,
      );
    }

    logger.info('Adjusted translated values to match original length', {
      adjustedLength: processedTranslatedValues.length,
    });
  }

  processedTranslatedValues = preserveEdgeWhitespace(
    textValues,
    processedTranslatedValues,
  );
  processedTranslatedValues = enforceBoundarySpaces(
    textValues,
    processedTranslatedValues,
  );
  processedTranslatedValues = enforcePunctuationBoundarySpaces(
    textValues,
    processedTranslatedValues,
  );

  return rebuildStructuredTextLeaves(
    fieldValueWithoutBlocks,
    textLeaves,
    processedTranslatedValues,
  ) as StructuredTextNode[];
}

interface TranslationPlanLogParams {
  logger: Logger;
  textValues: string[];
  textLeaves: StructuredTextTextLeaf[];
  blockNodeCount: number;
  fromLocale: string;
  toLocale: string;
}

function logTranslationPlan({
  logger,
  textValues,
  textLeaves,
  blockNodeCount,
  fromLocale,
  toLocale,
}: TranslationPlanLogParams): void {
  if (textValues.length > 0) {
    logger.info(`Found ${textValues.length} text nodes to translate`);
    logger.info('Structured text inline source payload', {
      fromLocale,
      toLocale,
      textLeaves,
      textValues,
    });
    return;
  }

  logger.info('No inline text values found; translating block nodes only', {
    fromLocale,
    toLocale,
    blockNodeCount,
  });
}

/**
 * Translates a structured text field value while preserving its structure
 *
 * @param initialValue - The structured text field value to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code
 * @param fromLocale - Source locale code
 * @param provider - TranslationProvider instance
 * @param apiToken - DatoCMS API token
 * @param environment - Dato environment
 * @param streamCallbacks - Optional callbacks for streaming responses
 * @param recordContext - Optional context about the record being translated
 * @param schemaRepository - Optional SchemaRepository for cached schema lookups
 * @returns The translated structured text value
 */
export async function translateStructuredTextValue(
  initialValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  apiToken: string,
  environment: string,
  streamCallbacks?: StreamCallbacks,
  recordContext = '',
  schemaRepository?: SchemaRepository,
  cmaBaseUrl?: string,
  contentAlreadyCloned = false,
): Promise<unknown> {
  // Create logger
  checkCancellation(streamCallbacks ?? {});
  const logger = createLogger(pluginParams, 'StructuredTextTranslation');

  let fieldValue: unknown = initialValue;
  let isAPIResponse = false;

  // Check if this is an API response format with document.children wrapper
  if (isAPIResponseFormat(initialValue)) {
    fieldValue = initialValue.document.children;
    isAPIResponse = true;
  }
  logger.info('Structured text source payload', {
    fromLocale,
    toLocale,
    isAPIResponse,
    value: initialValue,
    workingValue: fieldValue,
  });

  // Skip translation if null or not an array
  if (!fieldValue || !Array.isArray(fieldValue) || fieldValue.length === 0) {
    logger.info('Invalid structured text value', fieldValue);
    return initialValue;
  }

  logger.info('Translating structured text field', {
    nodeCount: fieldValue.length,
  });

  const noIdFieldValue = (contentAlreadyCloned ? fieldValue : cloneContent(fieldValue)) as StructuredTextNode[];
  const { leaves: textLeaves, blocks: blockLocations } = collectContent(noIdFieldValue);
  const blockNodes = blockLocations.map(({ node, rootIndex }) => ({
    ...node,
    ...(rootIndex !== undefined ? { originalIndex: rootIndex } : {}),
  }));
  const fieldValueWithoutBlocks = noIdFieldValue.filter(
    (node) => !isBlockNode(node),
  );
  const textValues = textLeaves.map((leaf) => leaf.value);

  if (textValues.length === 0 && blockNodes.length === 0) {
    logger.info('No text values or block nodes found to translate');
    return initialValue;
  }

  logTranslationPlan({
    logger,
    textValues,
    textLeaves,
    blockNodeCount: blockNodes.length,
    fromLocale,
    toLocale,
  });

  try {
    let finalReconstructedObject = fieldValueWithoutBlocks as StructuredTextNode[];

    if (textValues.length > 0) {
      finalReconstructedObject = await translateInlineTextLeaves({
        provider,
        pluginParams,
        textValues,
        textLeaves,
        fieldValueWithoutBlocks,
        fromLocale,
        toLocale,
        recordContext,
        logger,
        streamCallbacks,
      });
    }

    // If there are block nodes, translate them separately
    if (blockNodes.length > 0) {
      logger.info(`Translating ${blockNodes.length} block nodes`, {
        fromLocale,
        toLocale,
        blockNodes,
      });

      // Key change: Pass the entire blockNodes array to translateFieldValue
      // and use 'rich_text' as the field type instead of translating each block separately
      const translatedBlockNodes = (await translateFieldValue(
        blockNodes,
        pluginParams,
        toLocale,
        fromLocale,
        'rich_text', // Use rich_text instead of block
        provider,
        '',
        apiToken,
        '',
        environment,
        streamCallbacks,
        recordContext,
        schemaRepository,
        buildNestedTranslationOptions(cmaBaseUrl),
      )) as StructuredTextNode[];
      logger.info('Structured text translated block payload', {
        fromLocale,
        toLocale,
        translatedBlockNodes,
      });

      checkCancellation(streamCallbacks ?? {});
      // One pass replaces embedded blocks without copying the document per block.
      replaceTranslatedBlocks(translatedBlockNodes, blockLocations);
      finalReconstructedObject = noIdFieldValue;
    }

    checkCancellation(streamCallbacks ?? {});
    const cleanedReconstructedObject = finalReconstructedObject;

    if (isAPIResponse) {
      const originalWrapper = initialValue as APIResponseFormat;
      const apiResponsePayload = {
        ...originalWrapper,
        document: {
          ...originalWrapper.document,
          children: cleanedReconstructedObject,
        },
      };
      logger.info('Structured text translated payload', {
        fromLocale,
        toLocale,
        value: apiResponsePayload,
      });
      return apiResponsePayload;
    }

    logger.info('Successfully translated structured text', {
      fromLocale,
      toLocale,
      value: cleanedReconstructedObject,
    });
    return cleanedReconstructedObject;
  } catch (error) {
    rethrowAbortError(error);
    // DRY-001: Use centralized error handler
    handleTranslationError(
      error,
      provider.vendor,
      logger,
      'Error during structured text translation',
    );
  }
}
