import type {
  ExecuteFieldDropdownActionCtx,
  FieldDropdownActionsCtx,
} from 'datocms-plugin-sdk';
import get from 'lodash/get';
import isEqual from 'lodash/isEqual';
import toPath from 'lodash/toPath';

type FieldSnapshot = Pick<
  FieldDropdownActionsCtx,
  'formValues' | 'item' | 'itemType' | 'environment' | 'site'
>;

type Ancestor = {
  path: string[];
  fieldRelativePath: string[];
  identity: string | undefined;
  valueWithoutField: unknown;
};

type FieldRun = {
  originalContext: ExecuteFieldDropdownActionCtx;
  scope: string;
  savedRecord: boolean;
  latest: FieldSnapshot;
  expectedDraftValues: Record<string, unknown>;
  ancestors: Ancestor[];
  invalidated: boolean;
  ended: boolean;
};

// Only executing actions retain form snapshots. Visiting many records or
// rendering thousands of field menus must not create a project-wide cache.
const activeRuns = new Map<string, FieldRun>();
const contextRuns = new WeakMap<ExecuteFieldDropdownActionCtx, FieldRun>();

function snapshotFor(ctx: FieldSnapshot): FieldSnapshot {
  return {
    formValues: ctx.formValues,
    item: ctx.item,
    itemType: ctx.itemType,
    environment: ctx.environment,
    site: ctx.site,
  };
}

function scopeFor(ctx: FieldSnapshot): string {
  return JSON.stringify([
    ctx.site?.id,
    ctx.environment,
    ctx.item?.id ?? null,
    ctx.itemType?.id,
  ]);
}

function keyFor(ctx: ExecuteFieldDropdownActionCtx): string {
  // Localized field paths already contain the locale. A non-localized field
  // must share its lock when the editor changes the active locale tab.
  return JSON.stringify([scopeFor(ctx), ctx.fieldPath]);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function blockIdentity(value: Record<string, unknown>): string | undefined {
  const id = value.itemId ?? value.id ?? value.key;
  if (typeof id !== 'string' || id.length === 0) {
    return undefined;
  }

  return JSON.stringify([id, value.itemTypeId ?? value.blockModelId]);
}

/** Copies only ancestors along the path, preserving unrelated form subtrees. */
function replaceAtPath(
  value: unknown,
  path: string[],
  replacement: unknown,
): unknown {
  if (path.length === 0) {
    return replacement;
  }

  const copies: Array<Record<string, unknown> | unknown[]> = [];
  let cursor = value;
  for (const part of path) {
    const copy = Array.isArray(cursor)
      ? [...cursor]
      : { ...objectValue(cursor) };
    copies.push(copy);
    cursor = get(cursor, [part]);
  }

  let updated = replacement;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const copy = copies[index];
    if (Array.isArray(copy)) {
      copy[Number(path[index])] = updated;
    } else {
      copy[path[index]] = updated;
    }
    updated = copy;
  }
  return updated;
}

function ancestorsFor(ctx: ExecuteFieldDropdownActionCtx): Ancestor[] {
  const path = toPath(ctx.fieldPath);
  const ancestors: Ancestor[] = [];

  for (let depth = 1; depth < path.length; depth += 1) {
    const ancestorPath = path.slice(0, depth);
    const value = objectValue(get(ctx.formValues, ancestorPath));
    if (
      !value ||
      (!/^\d+$/.test(path[depth - 1]) &&
        !('itemTypeId' in value) &&
        !('blockModelId' in value))
    ) {
      continue;
    }

    const fieldRelativePath = path.slice(depth);
    ancestors.push({
      path: ancestorPath,
      fieldRelativePath,
      identity: blockIdentity(value),
      valueWithoutField: replaceAtPath(value, fieldRelativePath, undefined),
    });
  }
  return ancestors;
}

function ancestorsUnchanged(run: FieldRun): boolean {
  for (const ancestor of run.ancestors) {
    const current = objectValue(get(run.latest.formValues, ancestor.path));
    if (!current) {
      return false;
    }

    if (ancestor.identity !== undefined) {
      if (blockIdentity(current) !== ancestor.identity) {
        return false;
      }
    } else if (
      !isEqual(
        ancestor.valueWithoutField,
        replaceAtPath(current, ancestor.fieldRelativePath, undefined),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Observe every field menu, including non-media fields, during active runs. */
export function observeFieldContext(ctx: FieldDropdownActionsCtx): void {
  if (activeRuns.size === 0) {
    return;
  }

  const scope = scopeFor(ctx);
  for (const run of activeRuns.values()) {
    if (run.scope === scope && !run.invalidated) {
      run.latest = snapshotFor(ctx);
    }
  }
}

/**
 * The SDK has no public identifier for an unsaved form. Draft locks deliberately
 * share the model/path/locale scope rather than treating identical drafts as
 * independent runs and risking a second write to the same form.
 */
export function acquireFieldGenerationLock(
  ctx: ExecuteFieldDropdownActionCtx,
): (() => void) | undefined {
  const key = keyFor(ctx);
  if (activeRuns.has(key)) {
    return undefined;
  }

  const run: FieldRun = {
    originalContext: ctx,
    scope: scopeFor(ctx),
    savedRecord: Boolean(ctx.item?.id),
    latest: snapshotFor(ctx),
    expectedDraftValues: ctx.formValues,
    ancestors: ancestorsFor(ctx),
    invalidated: false,
    ended: false,
  };
  activeRuns.set(key, run);
  contextRuns.set(ctx, run);

  return () => {
    run.ended = true;
    if (activeRuns.get(key) === run) {
      activeRuns.delete(key);
    }
  };
}

/**
 * Keep execute-hook methods: observed dropdown contexts have no form methods.
 * A removed/reordered ancestor, or an ambiguous draft change, never falls back
 * to the stale click snapshot.
 */
export function getLatestFieldContext(
  ctx: ExecuteFieldDropdownActionCtx,
): ExecuteFieldDropdownActionCtx | undefined {
  const run = contextRuns.get(ctx);
  if (!run) {
    return ctx;
  }
  if (run.ended || run.invalidated) {
    return undefined;
  }

  if (
    !ancestorsUnchanged(run) ||
    (!run.savedRecord &&
      !isEqual(run.latest.formValues, run.expectedDraftValues))
  ) {
    run.invalidated = true;
    return undefined;
  }

  const latestContext = {
    ...run.originalContext,
    formValues: run.latest.formValues,
    item: run.latest.item,
  };
  contextRuns.set(latestContext, run);
  return latestContext;
}

/** Call with the context used for the successful setFieldValue invocation. */
export function recordFieldValueWrite(
  ctx: ExecuteFieldDropdownActionCtx,
  value: unknown,
): void {
  const run = contextRuns.get(ctx);
  if (!run || run.ended || run.invalidated) {
    return;
  }
  if (!ancestorsUnchanged(run)) {
    run.invalidated = true;
    return;
  }

  const previousValue = get(ctx.formValues, ctx.fieldPath);
  const latestValue = get(run.latest.formValues, ctx.fieldPath);
  if (isEqual(previousValue, latestValue)) {
    run.latest = {
      ...run.latest,
      formValues: replaceAtPath(
        run.latest.formValues,
        toPath(ctx.fieldPath),
        value,
      ) as Record<string, unknown>,
    };
  }

  if (!run.savedRecord) {
    run.expectedDraftValues = replaceAtPath(
      run.expectedDraftValues,
      toPath(ctx.fieldPath),
      value,
    ) as Record<string, unknown>;
  }
}
