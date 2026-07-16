/**
 * Invariant: modular/structured content must keep the same block COUNT and
 * NESTING shape across translation. A dropped or added block changes the
 * signature and blocks the (record,locale). Detects structure loss, NOT id leaks
 * (those are prevented by deepStripBlockIdentifiers; see spec §5 block-id-provenance). (spec §5)
 */
import type { BlockSignature } from '../types';
import type { QcFlag } from '../../../utils/translation/qc/types';

/** A DatoCMS nested block: { type: 'item', id, attributes, relationships }. */
function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>).type === 'item';
}

/** Recursively collect nested block arrays from a block's relationships/attributes. */
function childBlockArrays(block: Record<string, unknown>): unknown[][] {
  const arrays: unknown[][] = [];
  const scan = (node: unknown): void => {
    if (Array.isArray(node)) {
      if (node.some(isBlock)) arrays.push(node);
      else node.forEach(scan);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node as Record<string, unknown>).forEach(scan);
    }
  };
  scan(block.attributes);
  scan(block.relationships);
  return arrays;
}

/**
 * Builds the recursive block-count signature of a field value.
 */
export function blockSignatureOf(value: unknown): BlockSignature {
  const blocks = Array.isArray(value) ? value.filter(isBlock) : isBlock(value) ? [value] : [];
  const children: BlockSignature[] = [];
  for (const block of blocks) {
    for (const array of childBlockArrays(block)) children.push(blockSignatureOf(array));
  }
  return { count: blocks.length, children };
}

function signaturesEqual(a: BlockSignature, b: BlockSignature): boolean {
  if (a.count !== b.count || a.children.length !== b.children.length) return false;
  return a.children.every((child, i) => signaturesEqual(child, b.children[i]));
}

/**
 * Verifies that a translated block structure matches the source signature.
 */
export function checkBlockStructure(args: {
  value: unknown;
  expected: BlockSignature;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  if (signaturesEqual(blockSignatureOf(args.value), args.expected)) return null;
  return {
    checkId: 'block-structure',
    severity: 'error',
    fieldPath: args.fieldPath,
    locale: args.locale,
    message: 'Translated block structure differs from the source (a block was dropped, added, or re-nested).',
  };
}
