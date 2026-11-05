import { useEffect } from 'react';

const FALLBACK_BROWSER_WIDTH = 1440;
const MINIMUM_RECORD_PANE_WIDTH = 550;
/**
 * The Agent tab's starting chat width, and the narrowest it stays usable: below
 * it, the tab covers the chat with a "too narrow" notice.
 */
export const AGENT_PANE_WIDTH = 300;

/** Record pane width for the Agent tab, leaving `agentWidth` for the chat. */
export function inspectorRecordPaneWidth(
  browserOuterWidth: number | undefined,
  agentWidth: number = AGENT_PANE_WIDTH,
): number {
  const browserWidth =
    typeof browserOuterWidth === 'number' &&
    Number.isFinite(browserOuterWidth) &&
    browserOuterWidth > 0
      ? browserOuterWidth
      : FALLBACK_BROWSER_WIDTH;

  return Math.max(
    MINIMUM_RECORD_PANE_WIDTH,
    Math.round(browserWidth - agentWidth),
  );
}

/**
 * One width per browser, so an editor gets it in every project. Not keyed by
 * user ID: a collaborator's ID differs in each project, which would make it
 * per-project again. A browser profile already belongs to one person.
 */
const AGENT_WIDTH_KEY = 'dato-agent:inspector-width';

/** The chat width this editor last dragged the Agent tab to, in this browser. */
export function readAgentPaneWidth(): number | undefined {
  try {
    const width = Number.parseInt(
      localStorage.getItem(AGENT_WIDTH_KEY) ?? '',
      10,
    );
    return Number.isFinite(width) && width >= AGENT_PANE_WIDTH
      ? width
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Remembers the Agent tab's chat width whenever it changes, like the record
 * sidebar does. A width too narrow to use isn't saved, so the default comes
 * back instead. (Telling a drag from a window resize by `outerWidth` fails in
 * browsers that report the iframe's own size there, which lost every drag.)
 */
export function useRememberedAgentPaneWidth(): void {
  useEffect(() => {
    const remember = () => {
      if (window.innerWidth < AGENT_PANE_WIDTH) return;
      try {
        localStorage.setItem(
          AGENT_WIDTH_KEY,
          String(Math.round(window.innerWidth)),
        );
      } catch {
        // Dragging still works when iframe storage is blocked.
      }
    };
    window.addEventListener('resize', remember);
    return () => window.removeEventListener('resize', remember);
  }, []);
}
