import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import type {
  TableListChange,
  TableListRowTouched,
} from 'datocms-react-ui/TableList';
import isEqual from 'lodash-es/isEqual';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  denormalizeParameters,
  normalizeParameters,
  type Parameters,
  type RawFrontend,
  type RawViewport,
} from '../../types';
import { hasErrors, validateSettings } from './validation';

export type RowsTouched = (TableListRowTouched | undefined)[];

type Cell = { index: number; field: string };

let lastFrontendKey = 0;

/** A local id for the item of a frontend: the frontends have no id */
function newFrontendKey() {
  lastFrontendKey += 1;
  return `frontend-${lastFrontendKey}`;
}

function newFrontend(): RawFrontend {
  return {
    name: '',
    disabled: false,
    previewWebhook: '',
    customHeaders: [],
    visualEditing: { enableDraftModeUrl: '', initialPath: '' },
  };
}

/** The settings as the form starts from them: normalized, then raw again */
function formValues(parameters: Parameters): Parameters {
  return denormalizeParameters(normalizeParameters(parameters));
}

/**
 * The settings as the plugin reads them, so a value that only changed its
 * type ('375' and 375) or a feature that is off either way is no change
 */
function comparable(parameters: Parameters) {
  const normalized = normalizeParameters(parameters);

  return {
    ...normalized,
    frontends: normalized.frontends.map((frontend) => ({
      ...frontend,
      visualEditing: frontend.visualEditing?.enableDraftModeUrl
        ? frontend.visualEditing
        : undefined,
    })),
    iframeAllowAttribute: normalized.iframeAllowAttribute || undefined,
  };
}

/** Marks a cell of a list input as touched */
function touchCell(rows: RowsTouched, { index, field }: Cell): RowsTouched {
  // Dense, so a remove keeps the other rows in step
  const next = Array.from(
    { length: Math.max(rows.length, index + 1) },
    (_row, i) => rows[i],
  );
  const row = next[index];
  next[index] = { ...(typeof row === 'object' ? row : {}), [field]: true };
  return next;
}

/** The touched state of a list input follows its rows */
function followRows(rows: RowsTouched, change: TableListChange): RowsTouched {
  return change.type === 'remove'
    ? rows.filter((_row, i) => i !== change.index)
    : rows;
}

/**
 * Holds the touches that a press of the mouse causes until its click is
 * over. A mousedown on a control blurs the field first: the error that the
 * touch shows would move the control (Save comes after every section)
 * before the mouseup, and the click would be lost. A blur from the keyboard
 * touches at once.
 */
function useTouchesAfterClick() {
  const pressed = useRef(false);
  const pending = useRef<(() => void)[]>([]);

  /** Applies the touches that wait, in their order */
  const flush = useCallback(() => {
    const touches = pending.current;
    pending.current = [];
    for (const touch of touches) {
      touch();
    }
  }, []);

  useEffect(() => {
    const press = () => {
      pressed.current = true;
    };
    const release = () => {
      pressed.current = false;
      // The click of this press runs in the same task, before the timeout
      setTimeout(flush);
    };

    // In the capture phase, so the flag is set before the field blurs
    document.addEventListener('mousedown', press, true);
    document.addEventListener('mouseup', release, true);
    // The mouse can leave the frame while it is down
    window.addEventListener('blur', release);

    return () => {
      document.removeEventListener('mousedown', press, true);
      document.removeEventListener('mouseup', release, true);
      window.removeEventListener('blur', release);
    };
  }, [flush]);

  const touchAfterClick = useCallback((touch: () => void) => {
    if (pressed.current) {
      pending.current.push(touch);
    } else {
      touch();
    }
  }, []);

  return { touchAfterClick, flush };
}

export function useSettingsForm(ctx: RenderConfigScreenCtx) {
  const [baseline, setBaseline] = useState(() =>
    formValues(ctx.plugin.attributes.parameters as Parameters),
  );
  const [draft, setDraft] = useState<Parameters>(baseline);
  const [frontendKeys, setFrontendKeys] = useState(() =>
    (baseline.frontends ?? []).map(() => newFrontendKey()),
  );
  const [openFrontends, setOpenFrontends] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [viewportsOpen, setViewportsOpen] = useState(false);
  const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [touchedHeaders, setTouchedHeaders] = useState<
    Record<string, RowsTouched>
  >({});
  const [touchedViewports, setTouchedViewports] = useState<RowsTouched>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const { touchAfterClick, flush: flushTouches } = useTouchesAfterClick();

  const errors = validateSettings(draft);
  const viewportsInvalid = errors.viewports.some(hasErrors);
  const valid =
    !errors.frontends.some(hasErrors) &&
    !errors.defaultSidebarWidth &&
    !viewportsInvalid;
  const dirty = !isEqual(comparable(draft), comparable(baseline));

  const update = (patch: Partial<Parameters>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const updateFrontend = (index: number, patch: Partial<RawFrontend>) =>
    setDraft((current) => ({
      ...current,
      frontends: (current.frontends ?? []).map((frontend, i) =>
        i === index ? { ...frontend, ...patch } : frontend,
      ),
    }));

  const addFrontend = () => {
    const key = newFrontendKey();
    setDraft((current) => ({
      ...current,
      frontends: [...(current.frontends ?? []), newFrontend()],
    }));
    setFrontendKeys((keys) => [...keys, key]);
    setOpenFrontends((open) => new Set(open).add(key));
  };

  const removeFrontend = (index: number) => {
    setDraft((current) => ({
      ...current,
      frontends: (current.frontends ?? []).filter((_f, i) => i !== index),
    }));
    setFrontendKeys((keys) => keys.filter((_k, i) => i !== index));
  };

  const toggleFrontend = (key: string) =>
    setOpenFrontends((open) => {
      const next = new Set(open);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });

  /** A field shows its error once the user leaves it, or tries to save */
  const touchField = (path: string) =>
    touchAfterClick(() =>
      setTouchedFields((touched) =>
        touched.has(path) ? touched : new Set(touched).add(path),
      ),
    );

  const showsError = (path: string) =>
    submitAttempted || touchedFields.has(path);

  const followHeaders = (frontendKey: string, change: TableListChange) => {
    // A touch that waits for its click counts the rows as they were
    flushTouches();
    setTouchedHeaders((touched) => ({
      ...touched,
      [frontendKey]: followRows(touched[frontendKey] ?? [], change),
    }));
  };

  const touchHeaderCell = (frontendKey: string, cell: Cell) =>
    touchAfterClick(() =>
      setTouchedHeaders((touched) => ({
        ...touched,
        [frontendKey]: touchCell(touched[frontendKey] ?? [], cell),
      })),
    );

  const updateViewports = (
    viewports: RawViewport[],
    change: TableListChange,
  ) => {
    update({ defaultViewports: viewports });
    // A touch that waits for its click counts the rows as they were
    flushTouches();
    setTouchedViewports((touched) => followRows(touched, change));
  };

  const touchViewportCell = (cell: Cell) =>
    touchAfterClick(() =>
      setTouchedViewports((touched) => touchCell(touched, cell)),
    );

  /** A failed save opens every part that holds an error */
  const revealErrors = () => {
    setSubmitAttempted(true);
    setOpenFrontends((open) => {
      const next = new Set(open);
      for (const [index, frontendErrors] of errors.frontends.entries()) {
        const key = frontendKeys[index];
        if (key && hasErrors(frontendErrors)) {
          next.add(key);
        }
      }
      return next;
    });
    if (viewportsInvalid) {
      setViewportsOpen(true);
    }
  };

  const persist = async (saved: Parameters) => {
    setSaving(true);
    try {
      await ctx.updatePluginParameters(saved);
      const next = formValues(saved);
      setBaseline(next);
      // A change typed while the save ran stays in the form
      setDraft((current) => (current === saved ? next : current));
      setSubmitAttempted(false);
      setTouchedFields(new Set());
      setTouchedHeaders({});
      setTouchedViewports([]);
      ctx.notice('Settings saved');
    } catch (error) {
      // The draft stays in the form, so the user can save it again
      console.error(error);
      ctx.alert("The settings couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The click on Save is over: the blur that it caused touches now
    flushTouches();

    // Enter in a field submits too
    if (!dirty || saving) {
      return;
    }

    if (!valid) {
      revealErrors();
      return;
    }

    void persist(draft);
  };

  return {
    draft,
    errors,
    dirty,
    saving,
    saveFailed: submitAttempted && !valid,
    submitAttempted,
    frontendKeys,
    openFrontends,
    viewportsOpen,
    viewportsInvalid,
    touchedHeaders,
    touchedViewports,
    setViewportsOpen,
    update,
    updateFrontend,
    addFrontend,
    removeFrontend,
    toggleFrontend,
    touchField,
    showsError,
    followHeaders,
    touchHeaderCell,
    updateViewports,
    touchViewportCell,
    handleSubmit,
  };
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;
