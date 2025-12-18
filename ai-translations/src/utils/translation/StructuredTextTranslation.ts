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

import type { TranslationProvider, StreamCallbacks } from './types';
import { translateArray } from './translateArray';
import { normalizeProviderError } from './ProviderErrors';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { translateFieldValue } from './TranslateField';
import { createLogger } from '../logging/Logger';
import {
  extractTextValues,
  reconstructObject,
  insertObjectAtIndex,
  removeIds
} from './utils';

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
 * Ensures the array lengths match, with fallback strategies if they don't
 * 
 * @param originalValues - Original array of text values.
 * @param translatedValues - Translated array that might need adjustment.
 * @returns Adjusted translated values array matching original length.
 */
function ensureArrayLengthsMatch(originalValues: string[], translatedValues: string[]): string[] {
  if (originalValues.length === translatedValues.length) {
    return translatedValues;
  }
  
  // If too few elements, pad with the original values verbatim (including pure whitespace)
  // so that structural spaces between inline nodes are preserved.
  if (translatedValues.length < originalValues.length) {
    return [
      ...translatedValues,
      ...originalValues.slice(translatedValues.length)
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
function preserveEdgeWhitespace(originalValues: string[], translatedValues: string[]): string[] {
  const out: string[] = new Array(translatedValues.length);
  const isWsOnly = (s: string) => s === '' || /^[\s\u00A0]+$/.test(s);
  for (let i = 0; i < translatedValues.length; i++) {
    const orig = String(originalValues[i] ?? '');
    const tr = String(translatedValues[i] ?? '');
    if (isWsOnly(orig)) {
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
function alignSegmentsPreservingWhitespace(originalValues: string[], translatedValues: string[]): string[] {
  const out: string[] = [];
  let j = 0;
  const isWsOnly = (s: string) => s === '' || /^[\s\u00A0]+$/.test(s);
  for (let i = 0; i < originalValues.length; i++) {
    const orig = String(originalValues[i] ?? '');
    if (isWsOnly(orig)) {
      out.push(orig); // keep exact whitespace segment in place
    } else {
      const tr = j < translatedValues.length ? String(translatedValues[j++]) : orig;
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
function enforceBoundarySpaces(originalValues: string[], processed: string[]): string[] {
  const isWsOnly = (s: string) => s === '' || /^[\s\u00A0]+$/.test(s);
  const out = processed.slice();
  for (let i = 0; i < originalValues.length - 1; i++) {
    const oL = String(originalValues[i] ?? '');
    const oR = String(originalValues[i + 1] ?? '');
    // If either side is a dedicated whitespace segment, leave as-is
    if (isWsOnly(oL) || isWsOnly(oR)) continue;

    const needSpace = /[\s\u00A0]$/.test(oL) || /^[\s\u00A0]/.test(oR);
    if (!needSpace) continue;

    const pL = String(out[i] ?? '');
    const pR = String(out[i + 1] ?? '');
    const leftHas = /[\s\u00A0]$/.test(pL);
    const rightHas = /^[\s\u00A0]/.test(pR);
    if (!leftHas && !rightHas) {
      out[i] = pL + ' ';
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
function enforcePunctuationBoundarySpaces(originalValues: string[], processed: string[]): string[] {
  const out = processed.slice();
  for (let i = 0; i < originalValues.length - 1; i++) {
    const oL = String(originalValues[i] ?? '');
    const oR = String(originalValues[i + 1] ?? '');
    const endsPunctLeft = /[\.,;:!?]$/.test(oL.trimEnd());
    const startsPunctRight = /^[\.,;:!?]/.test(oR.trimStart());
    if (!endsPunctLeft && !startsPunctRight) continue;
    const pL = String(out[i] ?? '');
    const pR = String(out[i + 1] ?? '');
    const boundaryHasSpace = /[\s\u00A0]$/.test(pL) || /^[\s\u00A0]/.test(pR);
    const boundaryHasPunct = /[\.,;:!?]$/.test(pL) || /^[\.,;:!?]/.test(pR);
    if (!boundaryHasSpace && !boundaryHasPunct) {
      out[i] = pL + ' ';
    }
  }
  return out;
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
  recordContext = ''
): Promise<unknown> {
  // Create logger
  const logger = createLogger(pluginParams, 'StructuredTextTranslation');
  
  let fieldValue = initialValue;
  let isAPIResponse = false;

  if((fieldValue as { document: { children: unknown[] } })?.document?.children?.length) {
    fieldValue = (fieldValue as { document: { children: unknown[] } })?.document?.children
    isAPIResponse = true
  }

  // Skip translation if null or not an array
  if (!fieldValue || (!Array.isArray(fieldValue) || fieldValue.length === 0)) {
    logger.info('Invalid structured text value', fieldValue);
    return fieldValue;
  }

  logger.info('Translating structured text field', { nodeCount: fieldValue.length });

  // Remove any 'id' fields
  const noIdFieldValue = removeIds(fieldValue) as StructuredTextNode[];

  // Separate out block nodes and track their original positions
  const blockNodes = noIdFieldValue.reduce<StructuredTextNode[]>(
    (acc, node, index) => {
      if (node?.type === 'block') {
        acc.push({ ...node, originalIndex: index });
      }
      return acc;
    },
    []
  );

  // Filter out block nodes for inline translation first
  const fieldValueWithoutBlocks = noIdFieldValue.filter(
    (node) => node?.type !== 'block'
  );

  // Extract text strings from the structured text
  const textValues = extractTextValues(fieldValueWithoutBlocks);
  
  if (textValues.length === 0) {
    logger.info('No text values found to translate');
    return fieldValue;
  }

  logger.info(`Found ${textValues.length} text nodes to translate`);

  try {
    // Translate inline text values as an array using helper
    const translatedValues = await translateArray(
      provider,
      pluginParams,
      textValues,
      fromLocale,
      toLocale,
      { isHTML: false, recordContext }
    );

    // Check for length mismatch and attempt recovery
    let processedTranslatedValues = translatedValues;
    
    if (translatedValues.length !== textValues.length) {
      logger.warning(
        `Translation mismatch: got ${translatedValues.length} values, expected ${textValues.length}`,
        { original: textValues, translated: translatedValues }
      );
      
      // First align segments so pure-whitespace originals stay in-place
      processedTranslatedValues = alignSegmentsPreservingWhitespace(textValues, translatedValues);
      // If still off, pad/truncate conservatively
      if (processedTranslatedValues.length !== textValues.length) {
        processedTranslatedValues = ensureArrayLengthsMatch(textValues, processedTranslatedValues);
      }
      
      logger.info('Adjusted translated values to match original length', {
        adjustedLength: processedTranslatedValues.length
      });
    }

    // Re-apply original edge whitespace to avoid word concatenation across inline nodes
    processedTranslatedValues = preserveEdgeWhitespace(textValues, processedTranslatedValues);
    // Finally, enforce required boundary spaces when the original had them
    processedTranslatedValues = enforceBoundarySpaces(textValues, processedTranslatedValues);
    // And if the original left ended with punctuation but translator dropped it,
    // still keep a separating space.
    processedTranslatedValues = enforcePunctuationBoundarySpaces(textValues, processedTranslatedValues);

    // Reconstruct the inline text portion with the newly translated text
    const reconstructedObject = reconstructObject(
      fieldValueWithoutBlocks,
      processedTranslatedValues
    ) as StructuredTextNode[];

    // Insert block nodes back into their original positions
    let finalReconstructedObject = reconstructedObject;

    // If there are block nodes, translate them separately
    if (blockNodes.length > 0) {
      logger.info(`Translating ${blockNodes.length} block nodes`);
      
      // Key change: Pass the entire blockNodes array to translateFieldValue
      // and use 'rich_text' as the field type instead of translating each block separately
      const translatedBlockNodes = await translateFieldValue(
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
        recordContext
      ) as StructuredTextNode[];

      // Insert translated blocks back at their original positions
      for (const node of translatedBlockNodes) {
        if (node.originalIndex !== undefined) {
          finalReconstructedObject = insertObjectAtIndex(
            finalReconstructedObject,
            node,
            node.originalIndex
          );
        }
      }
    }

    // Remove temporary 'originalIndex' keys
    const cleanedReconstructedObject = (finalReconstructedObject as StructuredTextNode[]).map(
      ({ originalIndex, ...rest }) => rest
    );

    if(isAPIResponse) {
      return {
        document: {
          children: cleanedReconstructedObject,
          type: "root"
        },
        schema: "dast"
      }
    }

    logger.info('Successfully translated structured text');
    return cleanedReconstructedObject;
  } catch (error) {
    const normalized = normalizeProviderError(error, provider.vendor);
    logger.error('Error during structured text translation', { message: normalized.message, code: normalized.code, hint: normalized.hint });
    throw new Error(normalized.message);
  }
}
