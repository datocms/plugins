import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FieldFateTreeNode, { flattenLeaves } from './FieldFateTreeNode';
import type { FateFieldNode } from './types';

const leaf = (id: string, apiKey = id, required = false): FateFieldNode => ({
  id,
  apiKey,
  label: apiKey,
  required,
  fieldType: 'single_line',
});

const block = (id: string, children: FateFieldNode[]): FateFieldNode => ({
  id,
  apiKey: id,
  label: id,
  required: false,
  fieldType: 'rich_text',
  children,
});

const emptyLists = { excludedTokens: [], copyTokens: [] };

describe('flattenLeaves', () => {
  it('returns the node itself for a leaf', () => {
    expect(flattenLeaves(leaf('a')).map((n) => n.id)).toEqual(['a']);
  });
  it('returns only childless descendants of a block', () => {
    const tree = block('b', [leaf('x'), block('inner', [leaf('y'), leaf('z')])]);
    expect(flattenLeaves(tree).map((n) => n.id)).toEqual(['x', 'y', 'z']);
  });
});

describe('FieldFateTreeNode', () => {
  it('a leaf emits setFate output on change', () => {
    const onChange = vi.fn();
    render(
      <FieldFateTreeNode
        node={leaf('f1', 'title')}
        lists={emptyLists}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /copy/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextLists] = onChange.mock.calls[0];
    expect(nextLists.copyTokens).toContain('f1');
  });

  it('a block node cascades to all leaf descendants', () => {
    const onChange = vi.fn();
    render(
      <FieldFateTreeNode
        node={block('body', [leaf('h', 'heading'), leaf('c', 'caption')])}
        lists={emptyLists}
        onChange={onChange}
      />,
    );
    // Block is collapsed by default: only the parent rollup control is present.
    fireEvent.click(screen.getByRole('radio', { name: /copy/i }));
    const [nextLists] = onChange.mock.calls[0];
    expect([...nextLists.copyTokens].sort()).toEqual(['c', 'h']);
  });

  it('reports the required carve-out note when cascading skip', () => {
    const onChange = vi.fn();
    render(
      <FieldFateTreeNode
        node={block('body', [leaf('h', 'heading'), leaf('r', 'req', true)])}
        lists={emptyLists}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /skip/i }));
    const [nextLists, note] = onChange.mock.calls[0];
    expect(nextLists.excludedTokens).toEqual(['h']);
    expect(note).toMatch(/required/i);
  });

  it('resolves a legacy exclude token on a block sub-field to Skip (no data loss)', () => {
    // Regression guard vs the old flat picker: a block sub-field id stored in
    // the exclude list must still render as Skip once its block is expanded.
    render(
      <FieldFateTreeNode
        node={block('body', [leaf('bf1', 'caption')])}
        lists={{ excludedTokens: ['bf1'], copyTokens: [] }}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    // Both the block rollup and the expanded sub-field read Skip.
    const skipRadios = screen.getAllByRole('radio', {
      name: /skip/i,
    }) as HTMLInputElement[];
    expect(skipRadios.length).toBe(2);
    expect(skipRadios.every((radio) => radio.checked)).toBe(true);
  });

  it('shows the global-scope note on a non-default block sub-field', () => {
    render(
      <FieldFateTreeNode
        node={leaf('bf1', 'caption')}
        lists={{ excludedTokens: [], copyTokens: ['bf1'] }}
        insideBlock
        usageCountById={new Map([['bf1', 3]])}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/wherever this block is used/i)).toBeTruthy();
    expect(screen.getByText(/3 places/i)).toBeTruthy();
  });
});
