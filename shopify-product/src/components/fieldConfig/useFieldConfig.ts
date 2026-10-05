import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { isRecord } from '../../lib/guards';
import {
  defaultFieldParameters,
  isEmptyFieldParameters,
  normalizeFieldParameters,
} from '../../lib/parameters';
import type { FieldParametersV1, FieldType } from '../../types';
import {
  draftFromParams,
  draftFromRaw,
  type FieldConfigDraft,
  type LimitTexts,
  parametersFromDraft,
  parametersSignature,
} from './draft';
import { readErrors } from './errors';
import { useSavedParameters } from './useSavedParameters';

type Ctx = RenderManualFieldExtensionConfigScreenCtx;

/** Echoes of our own recent writes are ignored when they come back as ctx.parameters. */
const MAX_REMEMBERED_WRITES = 20;

export type FieldConfigState = {
  /** What the controls show. */
  draft: FieldConfigDraft;
  /** The parameters as the editor will read them (limits parsed and normalized). */
  effective: FieldParametersV1;
  /** A saved field (it has an ID). */
  isExistingField: boolean;
  /** A saved field with no parameters: every 1.x field. Nothing was written yet. */
  isLegacy: boolean;
  /** Saved parameters from an unknown version; they stay untouched until a change. */
  isUnsupported: boolean;
  /**
   * Version 1 settings the host flags and the controls show corrected (an
   * invalid combination saved through the API, say). Nothing was written yet.
   */
  needsRepair: boolean;
  /** What the field was saved with (null for a new field), for change warnings. */
  saved: FieldParametersV1 | null;
  update: (change: (params: FieldParametersV1) => FieldParametersV1) => void;
  updateLimits: (patch: Partial<LimitTexts>) => void;
  /** Writes the corrected settings the controls show. */
  repair: () => void;
};

function isUnsupportedParameters(raw: unknown): boolean {
  return (
    !isEmptyFieldParameters(raw) &&
    !(isRecord(raw) && raw.paramsVersion === '1')
  );
}

/** Flagged v1 settings that normalizing changed, so the controls can't show them as saved. */
function isRepairable(ctx: Ctx, draft: FieldConfigDraft): boolean {
  const raw = ctx.parameters;
  if (!isRecord(raw) || raw.paramsVersion !== '1') return false;
  if (Object.keys(readErrors(ctx.errors)).length === 0) return false;
  return (
    parametersSignature(parametersFromDraft(draft)) !== parametersSignature(raw)
  );
}

function initialDraft(ctx: Ctx, fieldType: FieldType): FieldConfigDraft {
  if (!ctx.pendingField.id && isEmptyFieldParameters(ctx.parameters)) {
    return draftFromParams(defaultFieldParameters(fieldType));
  }
  return draftFromRaw(ctx.parameters, fieldType);
}

/**
 * The field config screen's state. Every change is pushed to the host right
 * away with `ctx.setParameters` (the field modal owns Save). New fields get
 * the 2.0 defaults written once; saved fields without parameters (1.x) are
 * left alone until the developer changes something.
 */
export function useFieldConfig(
  ctx: Ctx,
  fieldType: FieldType,
): FieldConfigState {
  const isExistingField = Boolean(ctx.pendingField.id);
  const [draft, setDraft] = useState(() => initialDraft(ctx, fieldType));
  const [opened] = useState(() => ctx.parameters);
  const savedRaw = useSavedParameters(ctx);
  const [hasWritten, setHasWritten] = useState(false);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const draftRef = useRef(draft);
  const writtenRef = useRef<string[]>([]);
  const seenRef = useRef(parametersSignature(ctx.parameters));
  const wroteDefaultsRef = useRef(false);

  const write = (next: FieldConfigDraft) => {
    const output = parametersFromDraft(next);
    writtenRef.current = [
      ...writtenRef.current.slice(1 - MAX_REMEMBERED_WRITES),
      parametersSignature(output),
    ];
    draftRef.current = next;
    setDraft(next);
    setHasWritten(true);
    void ctxRef.current.setParameters(output);
  };
  const writeRef = useRef(write);
  writeRef.current = write;

  // A new field starts with the 2.0 defaults, written once.
  useEffect(() => {
    const current = ctxRef.current;
    if (wroteDefaultsRef.current || current.pendingField.id) return;
    if (!isEmptyFieldParameters(current.parameters)) return;
    wroteDefaultsRef.current = true;
    writeRef.current(draftRef.current);
  }, []);

  // Follow changes made outside this screen; ignore echoes of our own writes.
  const signature = parametersSignature(ctx.parameters);
  useEffect(() => {
    if (signature === seenRef.current) return;
    seenRef.current = signature;
    if (writtenRef.current.includes(signature)) return;
    const next = draftFromRaw(ctxRef.current.parameters, fieldType);
    draftRef.current = next;
    setDraft(next);
  }, [signature, fieldType]);

  const effective = normalizeFieldParameters(
    parametersFromDraft(draft),
    fieldType,
  );
  const untouched = !hasWritten;

  return {
    draft,
    effective,
    isExistingField,
    isLegacy:
      isExistingField && untouched && isEmptyFieldParameters(ctx.parameters),
    isUnsupported: untouched && isUnsupportedParameters(ctx.parameters),
    needsRepair: untouched && isRepairable(ctx, draft),
    saved: isExistingField
      ? normalizeFieldParameters(savedRaw ?? opened, fieldType)
      : null,
    update: (change) => {
      const current = draftRef.current;
      write({ ...current, params: change(current.params) });
    },
    updateLimits: (patch) => {
      const current = draftRef.current;
      write({ ...current, limits: { ...current.limits, ...patch } });
    },
    repair: () => write(draftRef.current),
  };
}
