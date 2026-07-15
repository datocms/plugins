/**
 * Tests for formSink.ts — the record (sidebar) path's live-form write sink
 * (spec §2.3 items 2, 6, 7).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeToForm } from './formSink';

/** Builds a `ctx.formValues`-shaped nested object from dot-path writes. */
const applyWrite = (
  formValues: Record<string, unknown>,
  fieldPath: string,
  value: unknown,
): void => {
  const [apiKey, locale] = fieldPath.split('.');
  const existing = (formValues[apiKey] as Record<string, unknown>) ?? {};
  formValues[apiKey] = { ...existing, [locale]: value };
};

/**
 * Drains the microtask queue so any pending `.then`/`await` continuations run
 * before we assert. `setTimeout(0)` yields a macrotask tick, which flushes all
 * currently-queued microtasks.
 */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('writeToForm', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Default mock: resolve the frame ASYNCHRONOUSLY (on a microtask) rather
    // than invoking the callback inline. This keeps `await nextFrame()` a real
    // suspension point so the simple tests exercise the same control flow the
    // ordering test scrutinizes, while still always resolving so they can just
    // `await writeToForm(...)`. The ordering test installs its own manual queue.
    rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback) => {
        queueMicrotask(() => cb(0));
        return 0;
      },
    );
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('gates each write behind an awaited requestAnimationFrame (§2.3-6)', async () => {
    // A NON-synchronous, manually-drained rAF mock — this is what proves the
    // await. A synchronous (immediate-invoke) mock cannot distinguish
    // `await nextFrame()` from a dropped await, because ctx.setFieldValue is
    // itself async and its own await already yields a microtask each iteration.
    // Here the sink can only advance when we release a frame.
    const pendingFrames: FrameRequestCallback[] = [];
    rafSpy.mockImplementation((cb: FrameRequestCallback) => {
      pendingFrames.push(cb);
      return pendingFrames.length;
    });
    const flushFrame = (): void => {
      const cb = pendingFrames.shift();
      if (cb) cb(0);
    };

    const formValues: Record<string, unknown> = {};
    const setFieldValue = vi.fn(async (path: string, value: unknown) => {
      applyWrite(formValues, path, value);
    });
    const writes = [
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
      { fieldPath: 'title.de', locale: 'de', value: 'Hallo' },
      { fieldPath: 'title.fr', locale: 'fr', value: 'Bonjour' },
    ];

    // Kick off the sink but DON'T await it yet — the loop should immediately
    // block on the first, un-flushed rAF.
    const done = writeToForm({
      writes,
      ctx: { setFieldValue, formValues },
      isCancelled: () => false,
    });

    // Let every already-queued microtask settle. If `await nextFrame()` were
    // dropped, the first setFieldValue would already have fired by now.
    await flushMicrotasks();
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(setFieldValue).not.toHaveBeenCalled();

    // Release one frame → exactly one write lands, then the loop blocks on the
    // next frame. Repeat per write, proving the 1:1 gate.
    for (let i = 0; i < writes.length; i += 1) {
      flushFrame();
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design — release one frame, settle, then assert before releasing the next.
      await flushMicrotasks();
      expect(setFieldValue).toHaveBeenCalledTimes(i + 1);
      // After the last write the loop exits; before that it's parked on the
      // NEXT frame it already requested.
      expect(rafSpy).toHaveBeenCalledTimes(Math.min(i + 2, writes.length));
    }

    const result = await done;
    expect(result).toEqual({ written: 3, discarded: 0, verifiedMissing: [] });
    expect(pendingFrames).toHaveLength(0);
  });

  it('discards every remaining write the instant isCancelled() flips true (§2.3-2)', async () => {
    const formValues: Record<string, unknown> = {};
    const setFieldValue = vi.fn(async (path: string, value: unknown) => {
      applyWrite(formValues, path, value);
    });
    const writes = [
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
      { fieldPath: 'title.de', locale: 'de', value: 'Hallo' },
      { fieldPath: 'title.fr', locale: 'fr', value: 'Bonjour' },
      { fieldPath: 'title.es', locale: 'es', value: 'Hola' },
    ];
    // Cancel flips true once the 2nd write has landed; the 3rd and 4th must be
    // discarded, never written.
    const isCancelled = () => setFieldValue.mock.calls.length >= 2;

    const result = await writeToForm({
      writes,
      ctx: { setFieldValue, formValues },
      isCancelled,
    });

    expect(setFieldValue).toHaveBeenCalledTimes(2);
    expect(setFieldValue).not.toHaveBeenCalledWith('title.fr', 'Bonjour');
    expect(setFieldValue).not.toHaveBeenCalledWith('title.es', 'Hola');
    expect(result.written).toBe(2);
    expect(result.discarded).toBe(2);
  });

  it('never calls setFieldValue once already cancelled before the first write', async () => {
    const formValues: Record<string, unknown> = {};
    const setFieldValue = vi.fn(async (path: string, value: unknown) => {
      applyWrite(formValues, path, value);
    });
    const writes = [
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
      { fieldPath: 'title.de', locale: 'de', value: 'Hallo' },
    ];

    const result = await writeToForm({
      writes,
      ctx: { setFieldValue, formValues },
      isCancelled: () => true,
    });

    expect(setFieldValue).not.toHaveBeenCalled();
    expect(result).toEqual({ written: 0, discarded: 2, verifiedMissing: [] });
  });

  it('collects a silently-dropped write into verifiedMissing (§6.3)', async () => {
    const formValues: Record<string, unknown> = { title: { it: 'Ciao' } };
    // setFieldValue "succeeds" for title.it but never actually lands title.de —
    // simulating a silently-dropped write the SDK swallowed.
    const setFieldValue = vi.fn(async () => {});
    const writes = [
      { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
      { fieldPath: 'title.de', locale: 'de', value: 'Hallo' },
    ];

    const result = await writeToForm({
      writes,
      ctx: { setFieldValue, formValues },
      isCancelled: () => false,
    });

    expect(result.written).toBe(2);
    expect(result.discarded).toBe(0);
    expect(result.verifiedMissing).toEqual(['title.de']);
  });

  it('does not flag a write that lands correctly', async () => {
    const formValues: Record<string, unknown> = {};
    const setFieldValue = vi.fn(async (path: string, value: unknown) => {
      applyWrite(formValues, path, value);
    });
    const writes = [{ fieldPath: 'title.it', locale: 'it', value: 'Ciao' }];

    const result = await writeToForm({
      writes,
      ctx: { setFieldValue, formValues },
      isCancelled: () => false,
    });

    expect(result.verifiedMissing).toEqual([]);
  });

  it('handles a value legitimately equal to undefined as missing, and null as present', async () => {
    const formValues: Record<string, unknown> = {};
    const setFieldValue = vi.fn(async (path: string, value: unknown) => {
      applyWrite(formValues, path, value);
    });
    const writes = [
      { fieldPath: 'hero.it', locale: 'it', value: null },
      { fieldPath: 'hero.de', locale: 'de', value: undefined },
    ];

    const result = await writeToForm({
      writes,
      ctx: { setFieldValue, formValues },
      isCancelled: () => false,
    });

    // null was written and reads back as null — present, not missing.
    // undefined can never be distinguished from "never written" by a
    // read-back check, so it is reported missing — this documents that
    // known limitation rather than asserting a false positive.
    expect(result.verifiedMissing).toEqual(['hero.de']);
  });

  it('returns an empty result for an empty writes array without calling rAF', async () => {
    const setFieldValue = vi.fn(async () => {});
    const result = await writeToForm({
      writes: [],
      ctx: { setFieldValue, formValues: {} },
      isCancelled: () => false,
    });

    expect(result).toEqual({ written: 0, discarded: 0, verifiedMissing: [] });
    expect(rafSpy).not.toHaveBeenCalled();
    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('never imports locale-sync fallback or verifyPersistedWrite modules (§2.3-7)', async () => {
    // Static assertion over the module's IMPORT statements only (not prose —
    // the source's own doc comments name both by way of explaining the
    // bypass): there is no persisted write to verify and no locale-sync
    // fallback to invoke until the user Saves the form.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, 'formSink.ts'),
      'utf-8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');

    expect(importLines).not.toMatch(/verifyPersistedWrite/);
    expect(importLines).not.toMatch(/locale-?[Ss]ync/i);
    // Belt-and-braces: no import line references either module's file path.
    expect(importLines).not.toMatch(/from ['"].*(verifyPersistedWrite|localeSync)/);
  });
});
