import { describe, expect, it } from 'vitest';
import { FILTER_SCHEMA } from './schema';
import {
  creatorKeys,
  creatorOfKey,
  editorValueOf,
  filterValueOf,
  valueKind,
} from './values';

const { meta, fieldTypes } = FILTER_SCHEMA;

describe('filter values', () => {
  it('picks the editor of each operator', () => {
    expect(valueKind(meta._status?.in ?? fieldTypes.json.exists)).toBe('enum');
    expect(valueKind(meta._creator?.eq ?? fieldTypes.json.exists)).toBe(
      'creator',
    );
    expect(valueKind(fieldTypes.string.matches)).toBe('matches');
    expect(valueKind(fieldTypes.lat_lon.near)).toBe('near');
    expect(valueKind(fieldTypes.float.gt)).toBe('number');
    expect(valueKind(fieldTypes.links.any_in)).toBe('text');
  });

  it('reads the yes/no select as a boolean, and null without a value', () => {
    expect(filterValueOf('true', fieldTypes.json.exists)).toBe(true);
    expect(filterValueOf('false', fieldTypes.json.exists)).toBe(false);
    expect(filterValueOf(null, fieldTypes.json.exists)).toBeNull();
    expect(editorValueOf(true, fieldTypes.json.exists)).toBe('true');
  });

  it('reads typed values from the editors, and null while incomplete', () => {
    expect(filterValueOf(12, fieldTypes.integer.eq)).toBe(12);
    expect(filterValueOf(1.5, fieldTypes.integer.eq)).toBeNull();
    expect(filterValueOf(1.5, fieldTypes.float.eq)).toBe(1.5);
    expect(filterValueOf(['a', ' b ', ''], fieldTypes.string.in)).toEqual([
      'a',
      'b',
    ]);
    expect(filterValueOf([], fieldTypes.string.in)).toBeNull();
    expect(filterValueOf(' news ', fieldTypes.text.matches)).toEqual({
      pattern: 'news',
    });
    expect(filterValueOf('  ', fieldTypes.string.eq)).toBeNull();
    expect(
      filterValueOf(['draft'], meta._status?.in ?? fieldTypes.json.exists),
    ).toEqual(['draft']);
    expect(
      filterValueOf([], meta._status?.in ?? fieldTypes.json.exists),
    ).toBeNull();
  });

  it('writes values back as their editors take them', () => {
    expect(editorValueOf(['a', 'b'], fieldTypes.string.in)).toEqual(['a', 'b']);
    expect(editorValueOf(null, fieldTypes.string.in)).toEqual([]);
    expect(editorValueOf({ pattern: 'x' }, fieldTypes.string.matches)).toBe(
      'x',
    );
    expect(editorValueOf(null, fieldTypes.string.eq)).toBe('');
    expect(editorValueOf(3, fieldTypes.integer.eq)).toBe(3);
  });

  it('keeps a date as the day, and sends a date and time in UTC', () => {
    expect(filterValueOf('2026-11-10', fieldTypes.date.gt)).toBe('2026-11-10');
    expect(
      filterValueOf('2026-11-10T09:30:00+02:00', fieldTypes.date_time.gt),
    ).toBe('2026-11-10T07:30:00.000Z');
    expect(filterValueOf('not a date', fieldTypes.date_time.gt)).toBeNull();
    expect(
      editorValueOf('2026-11-10T07:30:00.000Z', fieldTypes.date_time.gt),
    ).toBe('2026-11-10T07:30:00.000Z');
  });

  it('builds the point of a near filter only when it is complete', () => {
    const near = fieldTypes.lat_lon.near;
    expect(
      filterValueOf({ latitude: 45, longitude: 9, radius: 1000 }, near),
    ).toEqual({ latitude: 45, longitude: 9, radius: 1000 });
    expect(
      filterValueOf({ latitude: 45, longitude: null, radius: 1000 }, near),
    ).toBeNull();
    expect(editorValueOf(null, near)).toEqual({
      latitude: null,
      longitude: null,
      radius: null,
    });
  });

  it('turns the creators into keys for the select, and back', () => {
    const creatorIn = meta._creator?.in ?? fieldTypes.json.exists;
    const creatorEq = meta._creator?.eq ?? fieldTypes.json.exists;
    expect(creatorOfKey('user:12')).toEqual({ type: 'user', id: '12' });
    expect(creatorKeys([{ type: 'access_token', id: '3' }])).toEqual([
      'access_token:3',
    ]);
    expect(editorValueOf({ type: 'user', id: '12' }, creatorEq)).toBe(
      'user:12',
    );
    expect(filterValueOf(['user:12', 'sso_user:4'], creatorIn)).toEqual([
      { type: 'user', id: '12' },
      { type: 'sso_user', id: '4' },
    ]);
    expect(filterValueOf(null, creatorEq)).toBeNull();
  });
});
