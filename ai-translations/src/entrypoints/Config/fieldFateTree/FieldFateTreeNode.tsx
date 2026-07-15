/**
 * FieldFateTreeNode.tsx
 * ---------------------
 * One recursive row of the fate tree (spec §3). A leaf field renders a fate
 * control bound to `setFate`; a block-container field renders a rollup control
 * that cascades to its leaf descendants, plus its (collapsible) children. Block
 * sub-fields with a non-default fate carry the global-scope note (§3.1).
 */

import { useState } from 'react';
import FieldFateControl from './FieldFateControl';
import { cascadeFate, fateOf, flattenLeaves, rollup, setFate } from './fate';
import type { FateFieldNode, FateLists, FieldFate } from './types';
import s from './fieldFateTree.module.css';

export { flattenLeaves };

interface FieldFateTreeNodeProps {
  node: FateFieldNode;
  lists: FateLists;
  /** True when this node is a block sub-field — its fate is global (§3.1). */
  insideBlock?: boolean;
  /** node id → number of places the owning block is used, for the scope note. */
  usageCountById?: Map<string, number>;
  onChange: (nextLists: FateLists, note?: string) => void;
}

/**
 * Renders one field node and, for block containers, its collapsible subtree.
 */
export default function FieldFateTreeNode({
  node,
  lists,
  insideBlock = false,
  usageCountById,
  onChange,
}: FieldFateTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isBlock = Array.isArray(node.children);

  if (isBlock) {
    const leaves = flattenLeaves(node);
    const value = rollup(leaves.map((leaf) => fateOf(leaf, lists)));
    const cascade = (fate: FieldFate) => {
      const { lists: next, keptRequired } = cascadeFate(leaves, fate, lists);
      const note =
        keptRequired > 0
          ? `${keptRequired} required field${
              keptRequired === 1 ? '' : 's'
            } kept as Translate (can't be skipped)`
          : undefined;
      onChange(next, note);
    };
    return (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>
            <button
              type="button"
              className={s.expandToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? '▾' : '▸'}
            </button>
            <span className={s.rowName}>{node.label}</span>
            <span className={s.apiKeyBadge}>{node.apiKey}</span>
            <span className={s.requiredBadge}>block</span>
          </span>
          <FieldFateControl legend={node.label} value={value} onChange={cascade} />
        </div>
        {expanded && (
          <div className={s.children}>
            {node.children?.map((child) => (
              <FieldFateTreeNode
                key={child.id}
                node={child}
                lists={lists}
                insideBlock
                usageCountById={usageCountById}
                onChange={onChange}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  const value = fateOf(node, lists);
  const usageCount = usageCountById?.get(node.id);
  const showScopeNote = insideBlock && value !== 'translate';
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>
        <span className={s.rowName}>{node.label}</span>
        <span className={s.apiKeyBadge}>{node.apiKey}</span>
        {node.required && <span className={s.requiredBadge}>required</span>}
        {showScopeNote && (
          <span className={s.scopeNote}>
            applies wherever this block is used
            {usageCount ? ` (${usageCount} places)` : ''}
          </span>
        )}
      </span>
      <FieldFateControl
        legend={node.label}
        value={value}
        skipDisabled={node.required}
        onChange={(fate) => onChange(setFate(node.id, node.apiKey, fate, lists))}
      />
    </div>
  );
}
