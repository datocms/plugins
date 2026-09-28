import type { ConfirmOptions } from 'datocms-plugin-sdk';
import type { PlanFacts, PublishOffer } from '../contract';
import { type Copy, STRINGS } from './copy';

/**
 * The host confirm for a write: the title and the red choice repeat the
 * count, the content quotes the user's strings and names the consequences.
 * Resolves `true` only for the red choice.
 */
export function buildConfirmOptions(
  plan: PlanFacts,
  copy: Copy,
): ConfirmOptions {
  const text = copy.confirm(plan);

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
