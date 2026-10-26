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
import {
  type FeatureSwitches,
  hasErrors,
  validateSettings,
} from './validation';

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

/** The switches that the URLs of a frontend give: a feature with a URL is on */
function switchesOf(frontend: RawFrontend): FeatureSwitches {
  return {
    previewLinks: Boolean(frontend.previewWebhook),
    visualEditing: Boolean(frontend.visualEditing?.enableDraftModeUrl),
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
  // Keyed as the frontends: a switch stays with its frontend
  const [switches, setSwitches] = useState<
    Partial<Record<string, FeatureSwitches>>
  >(() =>
    Object.fromEntries(
      (baseline.frontends ?? []).map((frontend, index) => [
        frontendKeys[index],
        switchesOf(frontend),
      ]),
    ),
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

  // The switches of each frontend, in the order of the frontends
  const frontendSwitches = (draft.frontends ?? []).map(
    (frontend, index) =>
      switches[frontendKeys[index] ?? ''] ?? switchesOf(frontend),
  );
  const errors = validateSettings(draft, frontendSwitches);
  const viewportsInvalid = errors.viewports.some(hasErrors);
  const valid =
    !errors.frontends.some(hasErrors) &&
    !errors.defaultSidebarWidth &&
    !viewportsInvalid;
  // A switch turned on before its URL is typed is a change too: the save
  // then shows the error of the empty URL
  const dirty =
    !isEqual(comparable(draft), comparable(baseline)) ||
    !isEqual(frontendSwitches, (draft.frontends ?? []).map(switchesOf));

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
    const frontend = newFrontend();
    setDraft((current) => ({
      ...current,
      frontends: [...(current.frontends ?? []), frontend],
    }));
    setFrontendKeys((keys) => [...keys, key]);
    setSwitches((current) => ({ ...current, [key]: switchesOf(frontend) }));
    setOpenFrontends((open) => new Set(open).add(key));
  };

  const removeFrontend = (index: number) => {
    setDraft((current) => ({
      ...current,
      frontends: (current.frontends ?? []).filter((_f, i) => i !== index),
    }));
    setFrontendKeys((keys) => keys.filter((_k, i) => i !== index));
  };

  /**
   * Turns a feature of a frontend on or off. A feature that goes off loses
   * its URL, and its field forgets its touch: on again, the empty field
   * waits for a blur or a save before it shows its error.
   */
  const setFeature = (
    index: number,
    feature: keyof FeatureSwitches,
    on: boolean,
  ) => {
    const key = frontendKeys[index];

    if (!key) {
      return;
    }

    setSwitches((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? frontendSwitches[index]),
        [feature]: on,
      },
    }));

    if (on) {
      return;
    }

    setDraft((current) => ({
      ...current,
      frontends: (current.frontends ?? []).map((frontend, i) => {
        if (i !== index) {
          return frontend;
        }

        return feature === 'previewLinks'
          ? { ...frontend, previewWebhook: '' }
          : {
              ...frontend,
              visualEditing: {
                ...frontend.visualEditing,
                enableDraftModeUrl: '',
              },
            };
      }),
    }));

    const urlPath = `${key}.${feature === 'previewLinks' ? 'previewWebhook' : 'draftModeUrl'}`;
    setTouchedFields((touched) => {
      if (!touched.has(urlPath)) {
        return touched;
      }

      const next = new Set(touched);
      next.delete(urlPath);
      return next;
    });
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
    frontendSwitches,
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
    setFeature,
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
