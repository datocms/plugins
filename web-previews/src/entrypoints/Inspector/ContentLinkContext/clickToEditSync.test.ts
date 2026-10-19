import { describe, expect, it } from 'vitest';
import { createClickToEditSync } from './clickToEditSync';

function setup(preferred: boolean) {
  const applied: boolean[] = [];
  const deferred: Array<() => void> = [];
  const sync = createClickToEditSync({
    getPreferred: () => preferred,
    apply: (enabled) => applied.push(enabled),
    defer: (callback) => deferred.push(callback),
  });
  const flush = () => {
    for (const callback of deferred.splice(0)) callback();
  };
  return { sync, applied, flush };
}

describe('createClickToEditSync', () => {
  it('re-applies the choice after each page handshake, deferred', () => {
    const { sync, applied, flush } = setup(false);
    sync.onInit();
    expect(applied).toEqual([]);
    flush();
    expect(applied).toEqual([false]);

    // Full navigation inside the preview: same connection, new onInit
    sync.onInit();
    flush();
    expect(applied).toEqual([false, false]);
  });

  it('re-applies when the first report after onInit disagrees', () => {
    const { sync, applied, flush } = setup(false);
    sync.onInit();
    flush();
    sync.onStateChange(true);
    expect(applied).toEqual([false, false]);
  });

  it('leaves a matching first report alone', () => {
    const { sync, applied, flush } = setup(true);
    sync.onInit();
    flush();
    sync.onStateChange(true);
    expect(applied).toEqual([true]);
  });

  it('ignores later reports, such as Alt held in the page', () => {
    const { sync, applied, flush } = setup(true);
    sync.onInit();
    flush();
    sync.onStateChange(true);
    sync.onStateChange(false);
    expect(applied).toEqual([true]);
  });

  it('ignores reports before any onInit', () => {
    const { sync, applied } = setup(true);
    sync.onStateChange(false);
    expect(applied).toEqual([]);
  });
});
