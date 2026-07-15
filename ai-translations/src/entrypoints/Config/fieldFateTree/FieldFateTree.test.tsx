import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FieldFateTree from './FieldFateTree';
import type { FateModelNode } from './types';

const model: FateModelNode = {
  id: 'm1',
  name: 'Article',
  fields: [
    { id: 'f1', apiKey: 'title', label: 'Title', required: false, fieldType: 'single_line' },
    { id: 'f2', apiKey: 'body', label: 'Body', required: false, fieldType: 'textarea' },
  ],
  nonTranslatable: [{ label: 'Author' }],
};

const model2: FateModelNode = {
  id: 'landing1',
  name: 'Landing Page',
  fields: [
    { id: 'g1', apiKey: 'hero', label: 'Hero', required: false, fieldType: 'single_line' },
  ],
  nonTranslatable: [],
};

const emptyLists = { excludedTokens: [], copyTokens: [] };

const renderTree = (onChange = vi.fn()) => {
  render(<FieldFateTree models={[model]} lists={emptyLists} onChange={onChange} />);
  return onChange;
};

describe('FieldFateTree', () => {
  it('shows the model name and honest summary counts in the header', () => {
    renderTree();
    expect(screen.getByText('Article')).toBeTruthy();
    expect(screen.getByText(/2 translate/i)).toBeTruthy();
  });

  it('is collapsed by default — field controls are not rendered', () => {
    renderTree();
    expect(screen.queryByRole('radio', { name: /translate/i })).toBeNull();
  });

  it('expands on header click to reveal the fields and footer', () => {
    renderTree();
    fireEvent.click(screen.getByText('Article'));
    expect(screen.getAllByRole('radio', { name: /translate/i }).length).toBe(2);
    expect(screen.getByText(/aren't translatable/i)).toBeTruthy();
    expect(screen.getByText(/Author/)).toBeTruthy();
  });

  it('"Set all → Copy" copy-lists every leaf in the model', () => {
    const onChange = renderTree();
    fireEvent.click(screen.getByText('Article'));
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextLists] = onChange.mock.calls[0];
    expect([...nextLists.copyTokens].sort()).toEqual(['f1', 'f2']);
  });

  it('filters models by name', () => {
    render(
      <FieldFateTree
        models={[model, model2]}
        lists={emptyLists}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Article')).toBeTruthy();
    expect(screen.getByText('Landing Page')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/search models/i), {
      target: { value: 'landing' },
    });
    expect(screen.queryByText('Article')).toBeNull();
    expect(screen.getByText('Landing Page')).toBeTruthy();
  });

  it('filters models by id', () => {
    render(
      <FieldFateTree
        models={[model, model2]}
        lists={emptyLists}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/search models/i), {
      target: { value: 'm1' },
    });
    expect(screen.getByText('Article')).toBeTruthy();
    expect(screen.queryByText('Landing Page')).toBeNull();
  });
});
