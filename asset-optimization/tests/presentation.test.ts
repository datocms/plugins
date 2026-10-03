import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVITY_LOG_LIMIT,
  ASSET_PAGE_SIZE,
  getAssetPage,
  getVisibleActivityLog,
} from '../src/components/asset-optimization/presentation.ts';

test('10,000 results render in bounded pages without missing or duplicating assets', () => {
  const assets = Array.from({ length: 10_000 }, (_, id) => ({ id }));
  const visited: number[] = [];

  for (let page = 0; page < 100; page += 1) {
    const result = getAssetPage(assets, page);
    assert.equal(result.assets.length, ASSET_PAGE_SIZE);
    assert.equal(result.totalPages, 100);
    assert.equal(result.start, page * ASSET_PAGE_SIZE);
    visited.push(...result.assets.map((asset) => asset.id));
  }

  assert.deepEqual(
    visited,
    assets.map((asset) => asset.id),
  );
  assert.equal(new Set(visited).size, assets.length);
});

test('empty, small, and exactly one-page result sets retain their contents', () => {
  for (const length of [0, 1, 99, 100]) {
    const assets = Array.from({ length }, (_, id) => id);
    const result = getAssetPage(assets, 0);
    assert.deepEqual(result.assets, assets);
    assert.equal(result.totalPages, 1);
    assert.equal(result.end, length);
  }
});

test('partial last pages and shortened result sets never show an empty stale page', () => {
  const assets = Array.from({ length: 101 }, (_, id) => id);
  assert.deepEqual(getAssetPage(assets, 1).assets, [100]);
  assert.equal(getAssetPage(assets, -1).page, 0);
  assert.equal(getAssetPage(assets, 99).page, 1);
  assert.equal(getAssetPage(assets.slice(0, 50), 99).page, 0);
});

test('10,000 activity messages keep only the latest 300 visible in order', () => {
  const log = Array.from({ length: 10_000 }, (_, index) => ({
    text: `Message ${10_000 - index}`,
  }));
  const result = getVisibleActivityLog(log);
  assert.equal(result.entries.length, ACTIVITY_LOG_LIMIT);
  assert.equal(result.totalEntries, 10_000);
  assert.equal(result.omittedEntries, 9_700);
  assert.deepEqual(result.entries, log.slice(0, ACTIVITY_LOG_LIMIT));
  assert.equal(log.length, 10_000);
});

test('log counts include entries already discarded by the producer', () => {
  const log = Array.from({ length: 300 }, (_, index) => ({ text: `${index}` }));
  const result = getVisibleActivityLog(log, 19_700);
  assert.equal(result.entries.length, 300);
  assert.equal(result.totalEntries, 20_000);
  assert.equal(result.omittedEntries, 19_700);
});

test('small logs are complete and need no omission indicator', () => {
  for (const length of [0, 1, 299, 300]) {
    const log = Array.from({ length }, (_, index) => `${index}`);
    const result = getVisibleActivityLog(log);
    assert.deepEqual(result.entries, log);
    assert.equal(result.omittedEntries, 0);
    assert.equal(result.totalEntries, length);
  }
});
