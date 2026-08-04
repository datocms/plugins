import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

/**
 * Creates a TipTap extension that handles slash command suggestions.
 * This is separate from the mention node extensions - it only handles
 * the "/" trigger and suggestion lifecycle, not the rendering of mention nodes.
 */
export function createSlashSuggestionExtension() {
  return Extension.create({
    name: 'slashSuggestion',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          allowSpaces: true,
          startOfLine: false,
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}
