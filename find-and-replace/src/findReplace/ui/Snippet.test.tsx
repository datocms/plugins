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
  const snippet = container.querySelector('.fr-match__snippet');
  if (!snippet) {
    throw new Error('no snippet');
  }
  return snippet;
}

describe('Snippet', () => {
  it('highlights the match in find mode', () => {
    const snippet = renderSnippet({ kind: 'highlight' });
    expect(snippet).toHaveTextContent('the new Acme widget');
    expect(snippet.querySelector('mark.fr-mark')).toHaveTextContent('Acme');
    expect(snippet.querySelector('del, ins')).toBeNull();
  });

  it('previews a replacement as removed then inserted text', () => {
    const snippet = renderSnippet({ kind: 'diff', inserted: 'Globex' });
    expect(snippet.querySelector('del.fr-del')).toHaveTextContent('Acme');
    expect(snippet.querySelector('ins.fr-ins')).toHaveTextContent('Globex');
    expect(snippet.querySelector('.fr-sr-only')?.textContent).toBe(
      ' replaced with ',
    );
    expect(snippet.textContent).toBe(
      'the new Acme replaced with Globex widget',
    );
  });

  it('previews a removal with the struck-through text only', () => {
    const snippet = renderSnippet({ kind: 'diff', inserted: '' });
    expect(snippet.querySelector('del.fr-del')).toHaveTextContent('Acme');
    expect(snippet.querySelector('ins')).toBeNull();
    expect(snippet.querySelector('.fr-sr-only')).toBeNull();
  });

  it('tags a match that would not change', () => {
    const snippet = renderSnippet({ kind: 'noChange' });
    const tag = snippet.firstElementChild;
    expect(tag).toHaveClass('dl-row-tag');
    expect(tag).toHaveTextContent('No change');
    expect(snippet.querySelector('mark.fr-mark')).toHaveTextContent('Acme');
  });

  it('shows the written text after a run', () => {
    const snippet = renderSnippet({ kind: 'final', inserted: 'Globex' });
    expect(snippet.textContent).toBe('the new Globex widget');
    expect(snippet.querySelector('ins.fr-ins')).toHaveTextContent('Globex');
    expect(snippet.querySelector('del, mark')).toBeNull();
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
    expect(snippet.querySelector('del')?.innerHTML).toBe(
      'Ac<span class="fr-ws">↵</span>me',
    );
    expect(snippet.querySelector('ins')?.innerHTML).toBe(
      'Glo<span class="fr-ws">→</span>bex',
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
