import { Fragment } from 'react';

const BREAK_BEFORE = new Set(['?', '#', '&', '=']);
// "https://" (or a protocol-relative "//") stays whole, and so does its host.
const SCHEME = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

/** Where a line may break: after each "/" and before "?", "#", "&" and "=". */
function breakOffsets(url: string): number[] {
  const offsets: number[] = [];
  const start = (SCHEME.exec(url)?.[0].length ?? 0) + 1;
  for (let index = start; index < url.length; index += 1) {
    if (url[index - 1] === '/' || BREAK_BEFORE.has(url[index]))
      offsets.push(index);
  }
  return offsets;
}

/**
 * A URL that wraps at its separators instead of mid-word. The CSS keeps
 * `overflow-wrap: anywhere` for a part longer than the line.
 */
export function BreakableUrl({ url }: { url: string }) {
  const starts = [0, ...breakOffsets(url)];
  return (
    <>
      {starts.map((start, index) => (
        <Fragment key={start}>
          {index > 0 && <wbr />}
          {url.slice(start, starts[index + 1])}
        </Fragment>
      ))}
    </>
  );
}
