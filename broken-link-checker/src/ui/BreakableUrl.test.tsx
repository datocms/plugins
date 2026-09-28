import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BreakableUrl } from './BreakableUrl';

function markup(url: string) {
  const { container } = render(
    <span>
      <BreakableUrl url={url} />
    </span>,
  );
  const span = container.firstElementChild;
  expect(span?.textContent).toBe(url);
  return span?.innerHTML;
}

describe('BreakableUrl', () => {
  it('breaks after each "/" and before "?", "#", "&" and "="', () => {
    expect(markup('https://example.com/docs/a-b?x=1&y=2#top')).toBe(
      'https://example.com/<wbr>docs/<wbr>a-b<wbr>?x<wbr>=1<wbr>&amp;y<wbr>=2<wbr>#top',
    );
  });

  it('keeps the scheme and host whole and adds no trailing break', () => {
    expect(markup('https://example.com/')).toBe('https://example.com/');
    expect(markup('//cdn.example.net/a/')).toBe('//cdn.example.net/<wbr>a/');
    expect(markup('mailto:team@example.com')).toBe('mailto:team@example.com');
  });

  it('stays findable by the whole URL', () => {
    render(<BreakableUrl url="https://example.com/a?b=c" />);
    expect(screen.getByText('https://example.com/a?b=c')).toBeInTheDocument();
  });

  it('breaks once where a "/" meets a "?"', () => {
    expect(markup('/pricing/?plan=team')).toBe(
      '/<wbr>pricing/<wbr>?plan<wbr>=team',
    );
  });
});
