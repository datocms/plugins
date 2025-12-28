export type TriggerType = 'user' | 'field' | 'model' | 'asset' | 'record';

export type TriggerInfo = {
  type: TriggerType;
  query: string;
  startIndex: number;
};

/**
 * Detects if the user is currently typing a mention trigger.
 * Returns the trigger type and query if found.
 */
export function detectActiveTrigger(
  text: string,
  cursorPosition: number
): TriggerInfo | null {
  const textBeforeCursor = text.slice(0, cursorPosition);

  // Find the last @, #, $, ^, or & before cursor
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
  const lastHashIndex = textBeforeCursor.lastIndexOf('#');
  const lastDollarIndex = textBeforeCursor.lastIndexOf('$');
  const lastCaretIndex = textBeforeCursor.lastIndexOf('^');
  const lastAmpersandIndex = textBeforeCursor.lastIndexOf('&');

  // Determine which trigger is more recent
  const lastTriggerIndex = Math.max(
    lastAtIndex,
    lastHashIndex,
    lastDollarIndex,
    lastCaretIndex,
    lastAmpersandIndex
  );
  if (lastTriggerIndex === -1) return null;

  let triggerType: TriggerType;
  if (lastTriggerIndex === lastAtIndex) {
    triggerType = 'user';
  } else if (lastTriggerIndex === lastHashIndex) {
    triggerType = 'field';
  } else if (lastTriggerIndex === lastDollarIndex) {
    triggerType = 'model';
  } else if (lastTriggerIndex === lastCaretIndex) {
    triggerType = 'asset';
  } else {
    triggerType = 'record';
  }

  const textAfterTrigger = textBeforeCursor.slice(lastTriggerIndex + 1);

  // If there's a space after the trigger, the mention is complete/cancelled
  if (/\s/.test(textAfterTrigger)) return null;

  return {
    type: triggerType,
    query: textAfterTrigger.toLowerCase(),
    startIndex: lastTriggerIndex,
  };
}
