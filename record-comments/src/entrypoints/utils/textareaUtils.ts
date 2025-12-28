import type { RefObject } from 'react';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { Mention } from '@ctypes/mentions';
import { logError, logWarn } from '@/utils/errorLogger';

/**
 * Resolves a composer target which can be either a RefObject or a direct instance.
 */
type ComposerTarget = RefObject<TipTapComposerRef | null> | TipTapComposerRef;

function resolveComposer(target: ComposerTarget): TipTapComposerRef | null {
  // Check if it's a ref object (has .current property)
  if ('current' in target) {
    return target.current;
  }
  // Otherwise it's a direct instance
  return target;
}

/**
 * Insert a mention into a TipTap composer with retry logic.
 *
 * This is needed because after a modal/picker closes, the editor may need
 * a moment to regain focus and become ready for insertion. The retry loop
 * handles timing variations across different browsers and contexts.
 *
 * @param composerTarget - Ref to the TipTap composer or direct instance
 * @param mention - The mention to insert
 * @param options - Optional configuration for retries
 * @returns true if successful, false if all retries failed
 */
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
      // Only return true if composer was successfully resolved and methods were called
      if (composer) {
        composer.focus();
        composer.insertMention(mention);
        return true;
      }
      // Composer was null - continue to next attempt (it may become available)
      // Log on intermediate attempts for debugging timing issues
      if (attempt < maxRetries - 1) {
        logWarn(`insertMentionWithRetry: composer null on attempt ${attempt + 1}/${maxRetries}, retrying...`, {
          mentionType: mention.type,
        });
      }
    } catch (e) {
      // On last attempt, log and rethrow to let caller handle the error
      if (attempt === maxRetries - 1) {
        logError('insertMentionWithRetry: all retry attempts failed', e, {
          mentionType: mention.type,
          maxRetries,
        });
        throw e;
      }
      // Otherwise, log and continue to next retry
      logWarn(`insertMentionWithRetry: error on attempt ${attempt + 1}/${maxRetries}, retrying...`, {
        mentionType: mention.type,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // This point is reached if all attempts complete without throwing but also without
  // returning true (e.g., if composer was null on every attempt). Log and return false.
  logWarn('insertMentionWithRetry: all attempts exhausted, composer remained unavailable', {
    mentionType: mention.type,
    maxRetries,
  });
  return false;
}

