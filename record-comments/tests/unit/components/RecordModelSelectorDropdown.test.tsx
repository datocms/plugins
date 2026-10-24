// @vitest-environment jsdom

import RecordModelSelectorDropdown from '@components/RecordModelSelectorDropdown';
import type { ModelInfo } from '@hooks/useMentions';
import { act, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createCanvasCtx, renderInCanvas } from '../testUtils/canvas';

const models: ModelInfo[] = [
  { id: 'article', apiKey: 'article', name: 'Article', isBlockModel: false },
  { id: 'page', apiKey: 'page', name: 'Page', isBlockModel: false },
  { id: 'product', apiKey: 'product', name: 'Product', isBlockModel: false },
];

const ctx = createCanvasCtx();

function render(node: ReactNode) {
  return renderInCanvas(node, ctx);
}

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

describe('record model selector selection', () => {
  it.each([
    'Enter',
    'Tab',
  ])('selects the remaining model with %s after filtering a navigated list', (key) => {
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
  });

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

  it('keeps the focus in the search field on a press in the panel, and picks on click', () => {
    const onSelect = vi.fn();
    const view = render(
      <RecordModelSelectorDropdown
        models={models}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    const press = (element: Element) => {
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        element.dispatchEvent(event);
      });
      return event;
    };
    const title = Array.from(view.container.querySelectorAll('div')).find(
      (element) =>
        element.childElementCount === 0 &&
        element.textContent === 'Pick a model',
    );
    if (!title) throw new Error('Missing group title');
    const option = view.container.querySelectorAll('button')[1];

    // The search field takes the focus as any field
    expect(press(searchInput(view.container)).defaultPrevented).toBe(false);
    // The rest of the panel never moves it
    expect(press(title).defaultPrevented).toBe(true);
    expect(press(option).defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    act(() => {
      option.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(models[1]);
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
