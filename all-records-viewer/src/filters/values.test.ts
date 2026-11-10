import { describe, expect, it } from 'vitest';
import { FILTER_SCHEMA } from './schema';
import {
  creatorKeys,
  creatorOfKey,
  defaultValue,
  nearValue,
  textOf,
  valueKind,
  valueOfText,
} from './values';

const { meta, fieldTypes } = FILTER_SCHEMA;

describe('filter values', () => {
  it('picks the control of each operator', () => {
    expect(valueKind(meta._status?.in ?? fieldTypes.json.exists)).toBe('enum');
    expect(valueKind(meta._creator?.eq ?? fieldTypes.json.exists)).toBe(
      'creator',
    );
    expect(valueKind(fieldTypes.string.matches)).toBe('matches');
    expect(valueKind(fieldTypes.lat_lon.near)).toBe('near');
    expect(valueKind(fieldTypes.float.gt)).toBe('number');
    expect(valueKind(fieldTypes.links.any_in)).toBe('text');
  });

  it('starts a yes/no operator at true, as the dashboard does', () => {
    expect(defaultValue(fieldTypes.json.exists)).toBe(true);
    expect(defaultValue(fieldTypes.string.eq)).toBeNull();
  });

  it('reads typed values from text, and null while incomplete', () => {
    expect(valueOfText(' 12 ', fieldTypes.integer.eq)).toBe(12);
    expect(valueOfText('1.5', fieldTypes.integer.eq)).toBeNull();
    expect(valueOfText('a, b ,', fieldTypes.string.in)).toEqual(['a', 'b']);
    expect(valueOfText('1, x', fieldTypes.integer.eq)).toBeNull();
    expect(valueOfText('news', fieldTypes.text.matches)).toEqual({
      pattern: 'news',
    });
    expect(valueOfText('  ', fieldTypes.string.eq)).toBeNull();
  });

  it('writes values back as the text of their input', () => {
    expect(textOf(['a', 'b'], fieldTypes.string.in)).toBe('a, b');
    expect(textOf({ pattern: 'x' }, fieldTypes.string.matches)).toBe('x');
    const iso = valueOfText('2026-11-10T09:30', fieldTypes.date_time.gt);
    expect(typeof iso).toBe('string');
    expect(textOf(iso, fieldTypes.date_time.gt)).toBe('2026-11-10T09:30');
  });

  it('builds the point of a near filter and the creators', () => {
    expect(nearValue('45', '9', '1000')).toEqual({
      latitude: 45,
      longitude: 9,
      radius: 1000,
    });
    expect(nearValue('45', '', '1000')).toBeNull();
    expect(creatorOfKey('user:12')).toEqual({ type: 'user', id: '12' });
    expect(creatorKeys([{ type: 'access_token', id: '3' }])).toEqual([
      'access_token:3',
    ]);
  });
});
