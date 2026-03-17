import { describe, expect, it } from 'vitest';
import {
  parsePageQueryState,
  resolveEnvironmentPair,
} from './query';

describe('parsePageQueryState', () => {
  it('uses the default filter and leaves missing parameters undefined', () => {
    expect(parsePageQueryState('')).toEqual({
      leftEnv: undefined,
      rightEnv: undefined,
      filter: 'changed',
      entityType: undefined,
      entityId: undefined,
    });
  });

  it('reads valid query parameters and ignores invalid filter values', () => {
    expect(
      parsePageQueryState(
        '?leftEnv=alpha&rightEnv=beta&filter=unchanged&entityType=model&entityId=item-1',
      ),
    ).toEqual({
      leftEnv: 'alpha',
      rightEnv: 'beta',
      filter: 'unchanged',
      entityType: 'model',
      entityId: 'item-1',
    });

    expect(parsePageQueryState('?filter=unexpected')).toEqual({
      leftEnv: undefined,
      rightEnv: undefined,
      filter: 'changed',
      entityType: undefined,
      entityId: undefined,
    });
  });
});

describe('resolveEnvironmentPair', () => {
  it('returns null when there are not enough environments', () => {
    expect(
      resolveEnvironmentPair(['only-one'], 'only-one', {
        leftEnv: undefined,
        rightEnv: undefined,
      }),
    ).toBeNull();
  });

  it('prefers query values when they are available and distinct', () => {
    expect(
      resolveEnvironmentPair(['alpha', 'beta', 'gamma'], 'beta', {
        leftEnv: 'gamma',
        rightEnv: 'alpha',
      }),
    ).toEqual({
      leftEnv: 'gamma',
      rightEnv: 'alpha',
    });
  });

  it('falls back to the current environment and never returns the same environment twice', () => {
    const pair = resolveEnvironmentPair(['alpha', 'beta', 'gamma'], 'missing', {
      leftEnv: 'gamma',
      rightEnv: 'gamma',
    });

    expect(pair).not.toBeNull();
    expect(pair).toMatchObject({
      leftEnv: 'gamma',
    });
    expect(pair?.rightEnv).toMatch(/^(alpha|beta)$/);
    expect(pair?.rightEnv).not.toBe(pair?.leftEnv);
  });
});
