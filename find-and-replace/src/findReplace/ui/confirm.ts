import type { ConfirmOptions, RenderPageCtx } from 'datocms-plugin-sdk';
import type { PlanFacts, PublishOffer } from '../contract';
import { type Copy, STRINGS } from './copy';

/**
 * The host confirm for a write: the title and the red choice repeat the
 * count, the content quotes the user's strings and names the consequences.
 * A write to one record names it by `recordTitle` (see `singleRecordTitle`).
 * Resolves `true` only for the red choice.
 */
export function buildConfirmOptions(
  plan: PlanFacts,
  copy: Copy,
  recordTitle: string | null = null,
): ConfirmOptions {
  const text = copy.confirm(plan, recordTitle);

  return {
    title: text.title,
    content: text.content,
    choices: [{ label: text.choice, value: true, intent: 'negative' }],
    cancel: { label: STRINGS.cancel, value: false },
  };
}

/**
 * The host confirm for publishing after a run: publishing is constructive,
 * so the choice is the positive (brand) one. Resolves `true` only for it.
 */
export function buildPublishConfirmOptions(
  offer: PublishOffer,
  copy: Copy,
): ConfirmOptions {
  const text = copy.publishConfirm(offer);

  return {
    title: text.title,
    content: text.content,
    choices: [{ label: text.choice, value: true, intent: 'positive' }],
    cancel: { label: STRINGS.cancel, value: false },
  };
}

/**
 * The title of the one record that a write changes, as DatoCMS presents it
 * (`ctx.loadItemPresentationInfo`). Null for a write to many records, or
 * when the host can't give it: the confirm then counts the record.
 */
export async function singleRecordTitle(
  plan: PlanFacts,
  ctx: Pick<RenderPageCtx, 'loadItemPresentationInfo'>,
): Promise<string | null> {
  if (!plan.singleRecord) return null;
  try {
    const [info] = await ctx.loadItemPresentationInfo([plan.singleRecord.id]);
    return info?.title ?? null;
  } catch {
    return null;
  }
}
