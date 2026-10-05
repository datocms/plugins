import { useCallback, useMemo, useRef, useState } from 'react';
import { PERSIST_FAILED_MESSAGE } from '../../lib/fieldValue';
import {
  type ActionEnv,
  browse,
  convert,
  refreshLegacy,
  removeAt,
  reorder,
  replaceAt,
  updateHandle,
} from './editorActions';
import type { FocusTarget } from './useFieldFeedback';

export type ActionName =
  | 'browse'
  | 'replace'
  | 'remove'
  | 'reorder'
  | 'update-handle'
  | 'refresh'
  | 'convert';

export type EditorActions = {
  /** The action in progress; others wait until it settles. */
  busy: ActionName | null;
  browse: () => void;
  replace: (index: number) => void;
  remove: (index: number) => void;
  reorder: (from: number, to: number) => void;
  updateHandle: (key: string, handle: string) => void;
  refreshLegacy: () => void;
  convert: () => void;
};

/**
 * Where focus goes if the control that started an action disappears; the
 * actions refine it once they know which row they touch.
 */
const FOCUS_AFTER: Record<ActionName, FocusTarget[]> = {
  browse: ['first-row', 'add', 'browse'],
  replace: ['first-row'],
  remove: ['first-row', 'add', 'browse'],
  reorder: [],
  'update-handle': ['first-row'],
  refresh: ['first-row'],
  convert: ['first-row'],
};

/**
 * Binds the editor actions to the latest render's state. Every action runs
 * only from an editor's click or drag, one at a time, and never while the
 * field is disabled. Anything an action didn't handle itself (the host
 * connection dropping, say) ends in a toast, not a silent failure.
 */
export function useEditorActions(env: ActionEnv): EditorActions {
  const [busy, setBusy] = useState<ActionName | null>(null);
  const envRef = useRef(env);
  envRef.current = env;
  const busyRef = useRef<ActionName | null>(null);

  const run = useCallback(
    (name: ActionName, task: (current: ActionEnv) => Promise<void>) => {
      const current = envRef.current;
      if (current.ctx.disabled || busyRef.current) return;
      busyRef.current = name;
      setBusy(name);
      const token = current.feedback.expect(FOCUS_AFTER[name]);
      void task(current)
        .catch(() => {
          void current.ctx.alert(PERSIST_FAILED_MESSAGE);
        })
        .finally(() => {
          busyRef.current = null;
          setBusy(null);
          current.feedback.settle(token);
        });
    },
    [],
  );

  return useMemo(
    () => ({
      busy,
      browse: () => run('browse', browse),
      replace: (index: number) =>
        run('replace', (current) => replaceAt(current, index)),
      remove: (index: number) =>
        run('remove', (current) => removeAt(current, index)),
      reorder: (from: number, to: number) =>
        run('reorder', (current) => reorder(current, from, to)),
      updateHandle: (key: string, handle: string) =>
        run('update-handle', (current) => updateHandle(current, key, handle)),
      refreshLegacy: () => run('refresh', refreshLegacy),
      convert: () => run('convert', convert),
    }),
    [busy, run],
  );
}
