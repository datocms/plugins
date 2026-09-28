import { memo, type ReactNode } from 'react';
import { type MatchDisplay, type MatchView, UI_LIMITS } from '../contract';
import { STRINGS } from './copy';

/** Context around a match reads as prose: every whitespace run is one space. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

export function contextBefore(match: MatchView): string {
  const text = collapseWhitespace(match.before);
  return match.beforeTruncated ? `…${text.trimStart()}` : text;
}

export function contextAfter(match: MatchView): string {
  const text = collapseWhitespace(match.after);
  return match.afterTruncated ? `${text.trimEnd()}…` : text;
}

const LONG_HEAD = 40;
const LONG_TAIL = 30;

/**
 * Matched or removed text longer than 80 characters keeps its first 40 and
 * last 30 around " … ", so the inserted text stays inside the 3-line clamp.
 */
export function shortenMatched(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= UI_LIMITS.longMatchChars) {
    return text;
  }
  return `${chars.slice(0, LONG_HEAD).join('')} … ${chars.slice(-LONG_TAIL).join('')}`;
}

/** Inside a mark or a diff, line breaks and tabs stay visible as ↵ and →. */
function withWhitespaceMarkers(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const part of text.split(/(\r\n|\r|\n|\t)/)) {
    if (part === '') {
      continue;
    }
    if (part === '\t') {
      nodes.push(
        <span key={index} className="fr-ws">
          →
        </span>,
      );
    } else if (part === '\n' || part === '\r' || part === '\r\n') {
      nodes.push(
        <span key={index} className="fr-ws">
          ↵
        </span>,
      );
    } else {
      nodes.push(part);
    }
    index += 1;
  }
  return nodes;
}

function MatchBody({ display, text }: { display: MatchDisplay; text: string }) {
  switch (display.kind) {
    case 'highlight':
    case 'noChange':
      return (
        <mark className="fr-mark">
          {withWhitespaceMarkers(shortenMatched(text))}
        </mark>
      );
    case 'diff':
      return (
        <>
          <del className="fr-del">
            {withWhitespaceMarkers(shortenMatched(text))}
          </del>
          {display.inserted !== '' && (
            <>
              <span className="fr-sr-only">{STRINGS.replacedWith}</span>
              <ins className="fr-ins">
                {withWhitespaceMarkers(display.inserted)}
              </ins>
            </>
          )}
        </>
      );
    case 'final':
      return display.inserted === '' ? null : (
        <ins className="fr-ins">{withWhitespaceMarkers(display.inserted)}</ins>
      );
  }
}

/** One line of context with the match highlighted, previewed or written (§6.6). */
export const Snippet = memo(function Snippet({ match }: { match: MatchView }) {
  return (
    <div className="fr-match__snippet">
      {match.display.kind === 'noChange' && (
        <span className="dl-row-tag">{STRINGS.noChange}</span>
      )}
      {contextBefore(match)}
      <MatchBody display={match.display} text={match.text} />
      {contextAfter(match)}
    </div>
  );
});
