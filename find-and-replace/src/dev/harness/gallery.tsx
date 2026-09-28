import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useMemo } from 'react';
import type { FindReplaceSnapshot } from '../../findReplace/contract';
import { createCopy } from '../../findReplace/ui/copy';
import { FindReplaceApp } from '../../findReplace/ui/FindReplaceApp';
import {
  STATE_IDS,
  type StateFixture,
  type StateId,
  stateBoot,
  stateFixture,
} from '../../findReplace/ui/testing/fixtures';

/**
 * `?view=states&state=S1…S23`: the real `FindReplaceApp` rendered from a
 * snapshot fixture and a fake controller (no engine, no backend), for
 * reviewing states that are hard to reach by hand. States that are reached by
 * interacting (S12b: the model filter open; S13: the confirm) perform that
 * interaction once, after mount.
 */

type GalleryProps = {
  ctx: RenderPageCtx;
  state: string | null;
};

const INTERACTION_DELAY_MS = 300;

function readStateId(value: string | null): StateId {
  return STATE_IDS.find((id) => id === value) ?? 'S2';
}

/** The label of the button the fixture's interaction clicks. */
function interactionLabel(
  fixture: StateFixture,
  snapshot: FindReplaceSnapshot,
  locale: string,
): string | null {
  const copy = createCopy(locale);
  if (fixture.interaction === 'openModelFilter') {
    return copy.filterTrigger(snapshot.modelFilter.selected);
  }
  if (
    fixture.interaction === 'openConfirm' &&
    snapshot.primary.kind === 'replace'
  ) {
    return copy.primaryLabel(snapshot.primary.verb, snapshot.primary.count);
  }
  return null;
}

function clickButtonLabelled(label: string): boolean {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) =>
      !candidate.disabled && candidate.textContent?.trim() === label,
  );
  button?.click();
  return Boolean(button);
}

export function Gallery({ ctx, state }: GalleryProps) {
  const id = readStateId(state);
  const fixture = useMemo(() => stateFixture(id), [id]);
  const { boot } = useMemo(
    () =>
      stateBoot(id, () => {
        console.info('[gallery] retry');
      }),
    [id],
  );
  const locale = ctx.ui.locale;

  useEffect(() => {
    const label = fixture.snapshot
      ? interactionLabel(fixture, fixture.snapshot, locale)
      : null;
    if (!label) return;

    const timer = window.setTimeout(() => {
      if (!clickButtonLabelled(label)) {
        console.warn(`[gallery] ${fixture.id}: no enabled button "${label}"`);
      }
    }, INTERACTION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [fixture, locale]);

  return <FindReplaceApp ctx={ctx} boot={boot} />;
}
