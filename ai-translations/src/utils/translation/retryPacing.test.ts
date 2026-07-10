import { describe, expect, it } from 'vitest';
import { computeRetryDelay, createPacer } from './TranslationCore';

const noJitter = () => 0;

describe('computeRetryDelay', () => {
  it('prefers an explicit Retry-After hint', () =>
    expect(computeRetryDelay(5_000, 1, noJitter)).toBe(5_000));

  it('treats Retry-After: 0 as no usable hint and backs off instead', () => {
    // A literal `Retry-After: 0`, or a past HTTP-date clamped to 0, is not an
    // actionable wait: retrying instantly would hammer the still-limited
    // endpoint. Fall back to exponential backoff for the attempt.
    const backoff = computeRetryDelay(undefined, 3, noJitter);
    expect(computeRetryDelay(0, 3, noJitter)).toBe(backoff);
    expect(computeRetryDelay(0, 3, noJitter)).toBeGreaterThan(0);
  });

  it('falls back to exponential backoff when no hint exists', () => {
    const first = computeRetryDelay(undefined, 1, noJitter);
    const second = computeRetryDelay(undefined, 2, noJitter);
    expect(second).toBeGreaterThan(first);
  });

  it('adds at most 25% jitter to the backoff', () => {
    const base = computeRetryDelay(undefined, 1, () => 0);
    const jittered = computeRetryDelay(undefined, 1, () => 0.999);
    expect(jittered).toBeGreaterThan(base);
    expect(jittered).toBeLessThanOrEqual(base * 1.25);
  });

  it('jitters an explicit hint too, so waiters do not re-collide', () => {
    expect(computeRetryDelay(5_000, 1, () => 0.999)).toBeGreaterThan(5_000);
  });
});

describe('createPacer', () => {
  it('starts at the initial gap', () => expect(createPacer(100).gapMs()).toBe(100));

  it('doubles on each rate limit', () => {
    const pacer = createPacer(100);
    pacer.onRateLimit();
    expect(pacer.gapMs()).toBe(200);
    pacer.onRateLimit();
    expect(pacer.gapMs()).toBe(400);
  });

  it('caps the gap', () => {
    const pacer = createPacer(100);
    for (let i = 0; i < 20; i += 1) pacer.onRateLimit();
    expect(pacer.gapMs()).toBe(10_000);
  });

  it('decays only after five consecutive successes', () => {
    const pacer = createPacer(100);
    pacer.onRateLimit(); // 200
    for (let i = 0; i < 4; i += 1) pacer.onSuccess();
    expect(pacer.gapMs()).toBe(200);
    pacer.onSuccess();
    expect(pacer.gapMs()).toBe(100);
  });

  it('never decays below the initial gap', () => {
    const pacer = createPacer(100);
    for (let i = 0; i < 50; i += 1) pacer.onSuccess();
    expect(pacer.gapMs()).toBe(100);
  });

  it('resets the success streak on a rate limit', () => {
    const pacer = createPacer(100);
    pacer.onRateLimit(); // 200
    pacer.onSuccess();
    pacer.onSuccess();
    pacer.onRateLimit(); // 400, streak reset
    for (let i = 0; i < 4; i += 1) pacer.onSuccess();
    expect(pacer.gapMs()).toBe(400);
  });
});
