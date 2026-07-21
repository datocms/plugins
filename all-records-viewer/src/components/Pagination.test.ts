import { describe, expect, it } from 'vitest';
import { getPaginationWindow } from './Pagination';

describe('getPaginationWindow', () => {
  it('shows no more than ten centered pages', () => {
    expect(
      getPaginationWindow({
        currentPage: 20,
        perPage: 25,
        totalEntries: 1_000,
        maxPagesToShow: 10,
      }),
    ).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  });

  it('anchors the window at the beginning and end', () => {
    const base = { perPage: 25, totalEntries: 1_000, maxPagesToShow: 10 };
    expect(getPaginationWindow({ ...base, currentPage: 1 })).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(getPaginationWindow({ ...base, currentPage: 39 })).toEqual([
      30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    ]);
  });
});
