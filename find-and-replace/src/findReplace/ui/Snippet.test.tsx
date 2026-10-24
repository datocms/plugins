import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchDisplay } from '../contract';
import { Snippet, shortenMatched } from './Snippet';
import { makeMatch } from './testing/fixtures';

afterEach(() => {
  cleanup();
});

function renderSnippet(
  display: MatchDisplay,
  init: Partial<Parameters<typeof makeMatch>[0]> = {},
) {
  const { container } = render(
    <Snippet
      match={makeMatch({
        key: 'm',
        before: 'the new ',
        text: 'Acme',
        after: ' widget',
        display,
        ...init,
      })}
    />,
  );
  const snippet = container.querySelector<HTMLElement>('[data-snippet]');
  if (!snippet) {
    throw new Error('no snippet');
  }
  return snippet;
}

/** The text of an element with its ↵ and → markers spelled out. */
function withMarkers(element: Element | null): string {
  if (!element) {
    throw new Error('no element');
  }
  let text = '';
  for (const node of Array.from(element.childNodes)) {
    if (node instanceof HTMLElement && node.dataset.marker) {
      text += `[${node.dataset.marker}:${node.textContent}]`;
    } else {
      text += node.textContent;
    }
  }
  return text;
}

describe('Snippet', () => {
  it('highlights the match in find mode', () => {
    const snippet = renderSnippet({ kind: 'highlight' });
    expect(snippet).toHaveAttribute('data-snippet', 'highlight');
    expect(snippet).toHaveTextContent('the new Acme widget');
    expect(snippet.querySelector('mark')).toHaveTextContent('Acme');
    expect(snippet.querySelector('del, ins')).toBeNull();
  });

  it('previews a replacement as removed then inserted text', () => {
    const snippet = renderSnippet({ kind: 'diff', inserted: 'Globex' });
    expect(snippet.querySelector('del')).toHaveTextContent('Acme');
    expect(snippet.querySelector('ins')).toHaveTextContent('Globex');
    // Screen readers hear the change in words, between the two.
    const hidden = snippet.querySelector('.visually-hidden');
    expect(hidden?.textContent).toBe(' replaced with ');
    expect(hidden?.previousElementSibling?.tagName).toBe('DEL');
    expect(hidden?.nextElementSibling?.tagName).toBe('INS');
    expect(snippet.textContent).toBe(
      'the new Acme replaced with Globex widget',
    );
  });

  it('previews a removal with the struck-through text only', () => {
    const snippet = renderSnippet({ kind: 'diff', inserted: '' });
    expect(snippet.querySelector('del')).toHaveTextContent('Acme');
    expect(snippet.querySelector('ins')).toBeNull();
    expect(snippet.querySelector('.visually-hidden')).toBeNull();
    expect(snippet.textContent).toBe('the new Acme widget');
  });

  it('tags a match that would not change', () => {
    const snippet = renderSnippet({ kind: 'noChange' });
    // The tag leads the line, before the context.
    const tag = snippet.firstElementChild;
    expect(tag).toHaveTextContent('No change');
    expect(snippet.textContent).toBe('No changethe new Acme widget');
    expect(snippet.querySelector('mark')).toHaveTextContent('Acme');
    expect(snippet.querySelector('del, ins')).toBeNull();
  });

  it('shows the written text after a run', () => {
    const snippet = renderSnippet({ kind: 'final', inserted: 'Globex' });
    expect(snippet.textContent).toBe('the new Globex widget');
    expect(snippet.querySelector('ins')).toHaveTextContent('Globex');
    expect(snippet.querySelector('del, mark')).toBeNull();
  });

  it('shows only the context when a run removed the match', () => {
    const snippet = renderSnippet({ kind: 'final', inserted: '' });
    expect(snippet.textContent).toBe('the new  widget');
    expect(snippet.querySelector('del, ins, mark')).toBeNull();
  });

  it('collapses whitespace in the context and adds the ellipses', () => {
    const snippet = renderSnippet(
      { kind: 'highlight' },
      {
        before: '  said\n\n the  ',
        beforeTruncated: true,
        after: ' CEO,\tships \n',
        afterTruncated: true,
      },
    );
    expect(snippet.textContent).toBe('…said the Acme CEO, ships…');
  });

  it('keeps line breaks and tabs visible inside the match', () => {
    const snippet = renderSnippet(
      { kind: 'diff', inserted: 'Glo\tbex' },
      { text: 'Ac\nme' },
    );
    expect(withMarkers(snippet.querySelector('del'))).toBe(
      'Ac[line-break:↵]me',
    );
    expect(withMarkers(snippet.querySelector('ins'))).toBe('Glo[tab:→]bex');
  });

  it('marks line breaks inside a highlight too', () => {
    const snippet = renderSnippet({ kind: 'highlight' }, { text: 'Ac\r\nme' });
    expect(withMarkers(snippet.querySelector('mark'))).toBe(
      'Ac[line-break:↵]me',
    );
  });

  it('cuts matched text longer than 80 characters to 40 + " … " + 30', () => {
    const long = `${'a'.repeat(40)}${'b'.repeat(20)}${'c'.repeat(30)}`;
    expect(shortenMatched(long)).toBe(`${'a'.repeat(40)} … ${'c'.repeat(30)}`);
    expect(shortenMatched('x'.repeat(80))).toBe('x'.repeat(80));

    const inserted = 'z'.repeat(120);
    const snippet = renderSnippet({ kind: 'diff', inserted }, { text: long });
    expect(snippet.querySelector('del')).toHaveTextContent(
      `${'a'.repeat(40)} … ${'c'.repeat(30)}`,
    );
    expect(snippet.querySelector('ins')?.textContent).toBe(inserted);
  });
});
