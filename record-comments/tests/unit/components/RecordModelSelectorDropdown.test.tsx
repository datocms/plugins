// @vitest-environment jsdom

import RecordModelSelectorDropdown from '@components/RecordModelSelectorDropdown';
import type { ModelInfo } from '@hooks/useMentions';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../testUtils/react';

const models: ModelInfo[] = [
  { id: 'article', apiKey: 'article', name: 'Article', isBlockModel: false },
  { id: 'page', apiKey: 'page', name: 'Page', isBlockModel: false },
  { id: 'product', apiKey: 'product', name: 'Product', isBlockModel: false },
];

function searchInput(container: HTMLElement) {
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing model search input');
  return input;
}

function pressKey(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

function changeQuery(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (!setValue) throw new Error('Missing input value setter');
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('record model selector keyboard selection', () => {
  it.each(['Enter', 'Tab'])(
    'selects the remaining model with %s after filtering a navigated list',
    (key) => {
      const onSelect = vi.fn();
      const view = render(
        <RecordModelSelectorDropdown
          models={models}
          onSelect={onSelect}
          onClose={vi.fn()}
        />,
      );
      const input = searchInput(view.container);
      pressKey(input, 'ArrowDown');
      pressKey(input, 'ArrowDown');
      changeQuery(input, 'article');
      expect(view.container.querySelectorAll('button')).toHaveLength(1);
      pressKey(input, key);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(models[0]);
      view.unmount();
    },
  );

  it('does not select a missing model and recovers after clearing the search', () => {
    const onSelect = vi.fn();
    const view = render(
      <RecordModelSelectorDropdown
        models={models}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    const input = searchInput(view.container);
    pressKey(input, 'ArrowDown');
    changeQuery(input, 'missing');
    pressKey(input, 'ArrowDown');
    pressKey(input, 'Enter');
    pressKey(input, 'Tab');
    expect(onSelect).not.toHaveBeenCalled();
    changeQuery(input, '');
    pressKey(input, 'Enter');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(models[0]);
    view.unmount();
  });

  it('resets selection when available models change or become empty', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <RecordModelSelectorDropdown
        models={models}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const input = searchInput(view.container);
    pressKey(input, 'ArrowDown');
    pressKey(input, 'ArrowDown');
    view.rerender(
      <RecordModelSelectorDropdown
        models={[models[1]]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    pressKey(input, 'Enter');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(models[1]);
    onSelect.mockClear();
    view.rerender(
      <RecordModelSelectorDropdown
        models={[]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    pressKey(input, 'Enter');
    pressKey(input, 'Tab');
    expect(onSelect).not.toHaveBeenCalled();
    view.unmount();
  });
});
