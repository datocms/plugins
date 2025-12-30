import type { RefObject } from 'react';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { Mention } from '@ctypes/mentions';
import { logError, logWarn } from '@/utils/errorLogger';

type ComposerTarget = RefObject<TipTapComposerRef | null> | TipTapComposerRef;

function resolveComposer(target: ComposerTarget): TipTapComposerRef | null {
  if ('current' in target) {
    return target.current;
  }
  return target;
}

/** Retries needed because editor may not regain focus immediately after modal closes. */
export async function insertMentionWithRetry(
  composerTarget: ComposerTarget,
  mention: Mention,
  options?: { maxRetries?: number; delayMs?: number }
): Promise<boolean> {
  const { maxRetries = 5, delayMs = 100 } = options ?? {};

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const composer = resolveComposer(composerTarget);
      if (composer) {
        composer.focus();
        composer.insertMention(mention);
        return true;
      }
      if (attempt < maxRetries - 1) {
        logWarn(`insertMentionWithRetry: composer null on attempt ${attempt + 1}/${maxRetries}, retrying...`, {
          mentionType: mention.type,
        });
      }
    } catch (e) {
      if (attempt === maxRetries - 1) {
        logError('insertMentionWithRetry: all retry attempts failed', e, {
          mentionType: mention.type,
          maxRetries,
        });
        throw e;
      }
      logWarn(`insertMentionWithRetry: error on attempt ${attempt + 1}/${maxRetries}, retrying...`, {
        mentionType: mention.type,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logWarn('insertMentionWithRetry: all attempts exhausted, composer remained unavailable', {
    mentionType: mention.type,
    maxRetries,
  });
  return false;
}

