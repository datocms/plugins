import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fillingWidths, useFillingWidths } from './useFillingWidths';

/** Gives the frame a width, as a resize of the page would. */
function resizeFrame(width: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

afterEach(() => {
  // Back to jsdom's own value.
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
});

describe('fillingWidths', () => {
  it('gives the list all the width the panel leaves, past the kit’s 1100px', () => {
    expect(fillingWidths(2000)).toEqual({ listWidth: 1500, detailWidth: 500 });
    expect(fillingWidths(1300, 600)).toEqual({
      listWidth: 700,
      detailWidth: 600,
    });
  });

  it('keeps 360px for each side', () => {
    expect(fillingWidths(1200, 1000)).toEqual({
      listWidth: 360,
      detailWidth: 840,
    });
    expect(fillingWidths(1200, 100)).toEqual({
      listWidth: 840,
      detailWidth: 360,
    });
  });

  it('leaves the kit’s widths before the frame is measured', () => {
    expect(fillingWidths(0)).toEqual({
      listWidth: undefined,
      detailWidth: undefined,
    });
  });
});

describe('useFillingWidths', () => {
  it('follows the frame, and a resize of either side gives the other the rest', () => {
    resizeFrame(1800);
    const { result } = renderHook(() => useFillingWidths());
    expect(result.current).toMatchObject({ listWidth: 1300, detailWidth: 500 });

    resizeFrame(1600);
    expect(result.current).toMatchObject({ listWidth: 1100, detailWidth: 500 });

    act(() => result.current.onDetailWidthChange(700));
    expect(result.current).toMatchObject({ listWidth: 900, detailWidth: 700 });

    act(() => result.current.onListWidthChange(1000));
    expect(result.current).toMatchObject({ listWidth: 1000, detailWidth: 600 });
  });
});
