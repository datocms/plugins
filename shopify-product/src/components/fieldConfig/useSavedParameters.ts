import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { useEffect, useRef, useState } from 'react';
import { isRecord } from '../../lib/guards';

type Ctx = RenderManualFieldExtensionConfigScreenCtx;

/**
 * This extension's parameters in a saved field entity: `{}` when the saved
 * field uses another editor, undefined when the entity can't be read.
 */
export function savedParametersOf(
  field: unknown,
  pluginId: string,
  fieldExtensionId: string,
): Record<string, unknown> | undefined {
  if (!isRecord(field) || !isRecord(field.attributes)) return undefined;
  const { appearance } = field.attributes;
  if (!isRecord(appearance)) return undefined;
  const ours =
    appearance.editor === pluginId &&
    (appearance.field_extension === undefined ||
      appearance.field_extension === fieldExtensionId);
  if (!ours) return {};
  return isRecord(appearance.parameters) ? appearance.parameters : {};
}

function fromLoadedField(ctx: Ctx): Record<string, unknown> | undefined {
  const fieldId = ctx.pendingField.id;
  if (!fieldId) return undefined;
  return savedParametersOf(
    ctx.fields[fieldId],
    ctx.plugin.id,
    ctx.fieldExtensionId,
  );
}

/**
 * The parameters the field was last saved with, read from the project's
 * field entities rather than from `ctx.parameters` (which holds the pending,
 * unsaved settings, also after the screen is mounted again). Undefined for a
 * new field, and until the entity is known.
 */
export function useSavedParameters(
  ctx: Ctx,
): Record<string, unknown> | undefined {
  const [saved, setSaved] = useState(() => fromLoadedField(ctx));
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const knownRef = useRef(saved !== undefined);

  useEffect(() => {
    const current = ctxRef.current;
    const fieldId = current.pendingField.id;
    if (knownRef.current || !fieldId) return;
    let active = true;
    current.loadItemTypeFields(current.itemType.id).then(
      (fields) => {
        const params = savedParametersOf(
          fields.find((field) => field.id === fieldId),
          current.plugin.id,
          current.fieldExtensionId,
        );
        if (!active || params === undefined) return;
        knownRef.current = true;
        setSaved(params);
      },
      () => {
        // Without the saved entity, the settings the screen opened with stand in.
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return saved;
}
