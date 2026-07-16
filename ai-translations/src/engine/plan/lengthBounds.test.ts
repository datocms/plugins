import { describe, expect, it } from 'vitest';
import { lengthBoundsOf } from './lengthBounds';

describe('lengthBoundsOf', () => {
  it('extracts max, and min+max, from a length validator', () => {
    expect(lengthBoundsOf({ length: { max: 100 } } as never)).toEqual({ max: 100 });
    expect(lengthBoundsOf({ length: { min: 3, max: 9 } } as never)).toEqual({ min: 3, max: 9 });
    expect(lengthBoundsOf({ length: { eq: 5 } } as never)).toEqual({ eq: 5 });
  });

  it('returns undefined when there is no length validator', () => {
    expect(lengthBoundsOf({} as never)).toBeUndefined();
    expect(lengthBoundsOf({ required: {} } as never)).toBeUndefined();
    expect(lengthBoundsOf(undefined as never)).toBeUndefined();
  });

  it('returns undefined for an empty length object', () => {
    expect(lengthBoundsOf({ length: {} } as never)).toBeUndefined();
  });
});
