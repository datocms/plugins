import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { Mention } from '@ctypes/mentions';
import type { RefObject } from 'react';
import { logError, logWarn } from '@/utils/errorLogger';

type ComposerTarget = RefObject<TipTapComposerRef | null> | TipTapComposerRef;

function resolveComposer(target: ComposerTarget): TipTapComposerRef | null {
  if ('current' in target) {
    return target.current;
  }
  return target;
}

async function tryInsertMention(
  composerTarget: ComposerTarget,
  mention: Mention,
  attempt: number,
  maxRetries: number,
  delayMs: number,
): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const composer = resolveComposer(composerTarget);
  if (composer) {
    composer.focus();
    composer.insertMention(mention);
    return true;
  }
  if (attempt < maxRetries - 1) {
    logWarn(
      `insertMentionWithRetry: composer null on attempt ${attempt + 1}/${maxRetries}, retrying...`,
      { mentionType: mention.type },
    );
  }
  return false;
}

async function retryInsertMention(
  composerTarget: ComposerTarget,
  mention: Mention,
  maxRetries: number,
  delayMs: number,
): Promise<boolean> {
  if (maxRetries === 0) {
    return false;
  }

  try {
    const succeeded = await tryInsertMention(
      composerTarget,
      mention,
      0,
      maxRetries,
      delayMs,
    );
    if (succeeded) return true;
  } catch (e) {
    if (maxRetries <= 1) {
      logError('insertMentionWithRetry: all retry attempts failed', e, {
        mentionType: mention.type,
        maxRetries,
      });
      throw e;
    }
    logWarn(
      `insertMentionWithRetry: error on attempt 1/${maxRetries}, retrying...`,
      {
        mentionType: mention.type,
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }

  return retryInsertMention(composerTarget, mention, maxRetries - 1, delayMs);
}

/** Retries needed because editor may not regain focus immediately after modal closes. */
export async function insertMentionWithRetry(
  composerTarget: ComposerTarget,
  mention: Mention,
  options?: { maxRetries?: number; delayMs?: number },
): Promise<boolean> {
  const { maxRetries = 5, delayMs = 100 } = options ?? {};

  const succeeded = await retryInsertMention(
    composerTarget,
    mention,
    maxRetries,
    delayMs,
  );

  if (!succeeded) {
    logWarn(
      'insertMentionWithRetry: all attempts exhausted, composer remained unavailable',
      { mentionType: mention.type, maxRetries },
    );
  }

  return succeeded;
}
