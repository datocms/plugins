/**
 * useCloseOnEscape.ts
 * -------------------
 * The dialogs of the plugin open with no host cross (`closeDisabled`), so
 * the host's Escape doesn't close them: each state of a dialog registers its
 * own. The normal content registers its Cancel or Close; this hook is for the
 * states that replace it (the error fallback, the invalid-parameters slate),
 * whose only way out is a Close button.
 */
import { useRegisterActions } from 'datocms-react-ui/Actions';

/** The Escape of a dialog state whose way out is its Close button. */
const CLOSE_ACTION_ID = 'aiTranslations.dialogClose';

/**
 * Registers Escape as the Close of a dialog, a key with no place in the
 * command palette. With no `onClose` (a page, a sidebar panel, the config
 * screen) it registers nothing.
 *
 * @param onClose - Closes the dialog with the value that a dismissal means
 *   to its caller.
 */
export function useCloseOnEscape(onClose: (() => void) | undefined): void {
  useRegisterActions(
    onClose
      ? [
          {
            id: CLOSE_ACTION_ID,
            name: 'Close',
            shortcut: { key: 'escape' },
            palette: 'hidden',
            run: onClose,
          },
        ]
      : [],
  );
}
