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
    const selected = new Set(
      options.slice(0, 100).map((option) => option.value),
    );
    const visible = visibleChipOptions(options, '', selected);
    expect(visible).toHaveLength(100);
    expect(visible[0]).toBe(options[100]);
  });

  it('uses a compact count above 100 selections while retaining selected options for removal', () => {
    const selected = options.slice(0, 200);
    const { result } = renderHook(() =>
      useBoundedChipSelect(options, selected, 'models'),
    );
    expect(result.current.selectProps.controlShouldRenderValue).toBe(false);
    expect(result.current.selectProps.hideSelectedOptions).toBe(false);
    expect(result.current.placeholder('Select models…')).toBe(
      '200 models selected',
    );
    expect(result.current.selectProps.isOptionSelected?.(options[199])).toBe(
      true,
    );
    act(() => result.current.selectProps.onInputChange?.('api_key_199'));
    expect(result.current.selectProps.options).toEqual([options[199]]);
    expect(selected).toHaveLength(200);
  });
});
