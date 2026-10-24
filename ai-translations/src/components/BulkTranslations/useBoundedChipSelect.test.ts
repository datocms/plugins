import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHIP_OPTION_LIMIT,
  useBoundedChipSelect,
  visibleChipOptions,
} from './useBoundedChipSelect';

const options = Array.from({ length: 1000 }, (_, index) => ({
  value: `${index}`,
  label: `Modèle ${index}`,
  code: `api_key_${index}`,
}));

const values = (count: number) =>
  options.slice(0, count).map((option) => option.value);

describe('bounded chip selects', () => {
  afterEach(cleanup);

  it('keeps small menus identical and caps large ones without dropping catalog search', () => {
    const small = options.slice(0, 10);
    expect(visibleChipOptions(small, '')).toBe(small);
    expect(visibleChipOptions(options, '')).toHaveLength(CHIP_OPTION_LIMIT);
    expect(visibleChipOptions(options, 'api_key_999')).toEqual([options[999]]);
    expect(visibleChipOptions(options, 'modele 999')).toEqual([options[999]]);
  });

  it('removes hidden selections before capping the visible menu', () => {
    const selected = new Set(values(100));
    const visible = visibleChipOptions(options, '', selected);
    expect(visible).toHaveLength(100);
    expect(visible[0]).toBe(options[100]);
  });

  it('lets a small catalog filter itself, also by API key', () => {
    const small = options.slice(0, 10);
    const { result } = renderHook(() =>
      useBoundedChipSelect(small, [], 'models'),
    );
    const { selectProps } = result.current;
    expect(selectProps.options).toBe(small);
    expect(selectProps.search).toBeUndefined();
    expect(selectProps.controlShouldRenderValue).toBeUndefined();
    expect(result.current.hint).toBeUndefined();
    expect(result.current.placeholder('Pick models')).toBe('Pick models');
    expect(selectProps.filterOption?.({ data: small[3] }, 'API_KEY_3')).toBe(
      true,
    );
    expect(selectProps.filterOption?.({ data: small[3] }, 'modele 4')).toBe(
      false,
    );
  });

  it('searches a large catalog itself and still labels selections outside the visible options', () => {
    const { result } = renderHook(() =>
      useBoundedChipSelect(options, values(3), 'models'),
    );
    expect(result.current.selectProps.filterOption).toBeUndefined();
    expect(result.current.hint).toBe(
      'Showing up to 100 results. Type to search all models.',
    );
    expect(
      result.current.selectProps.acceptValueNotIncludedInOptions('999'),
    ).toBe(options[999]);
    expect(
      result.current.selectProps.acceptValueNotIncludedInOptions('missing'),
    ).toBeUndefined();
    act(() => result.current.selectProps.search?.onQueryChange('api_key_999'));
    expect(result.current.selectProps.options).toEqual([options[999]]);
  });

  it('uses a compact count above 100 selections while retaining selected options for removal', () => {
    const selected = values(200);
    const { result } = renderHook(() =>
      useBoundedChipSelect(options, selected, 'models'),
    );
    expect(result.current.selectProps.controlShouldRenderValue).toBe(false);
    expect(result.current.selectProps.hideSelectedOptions).toBe(false);
    expect(result.current.placeholder('Pick models')).toBe(
      '200 models selected',
    );
    expect(result.current.hint).toBe(
      'Showing up to 100 results. Type to search all models. Search a selected entry to remove it.',
    );
    act(() => result.current.selectProps.search?.onQueryChange('api_key_199'));
    expect(result.current.selectProps.options).toEqual([
      { label: 'Selected models', options: [options[199]] },
    ]);
    act(() => result.current.selectProps.search?.onQueryChange('api_key_99'));
    expect(result.current.selectProps.options).toEqual([
      { label: 'Selected models', options: [options[99]] },
      { label: 'Other models', options: options.slice(990) },
    ]);
    expect(selected).toHaveLength(200);
  });
});
